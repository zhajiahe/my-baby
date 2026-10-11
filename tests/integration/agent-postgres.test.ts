import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { ContractError } from '../../shared/agent'
import { prismaStore } from '../../src/lib/agent/prisma-store'
import { executeOperation, type AgentStore } from '../../src/lib/agent/service'
import { agentHandler } from '../../src/lib/agent/handler'

// This file deliberately ignores DATABASE_URL. Running it directly against the
// application's environment must fail before opening any connection.
const url = process.env.MYBABY_TEST_DATABASE_URL
const marker = process.env.MYBABY_TEST_DB_MARKER
const directory = process.env.MYBABY_TEST_DB_DIR
if (!url || !marker || !directory) throw new Error('use_npm_run_test_postgres_disposable_runner')
function testUrl(value: string): URL {
  try { return new URL(value) } catch { throw new Error('disposable_database_required') }
}
const parsed = testUrl(url)
if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.username !== 'mybaby_test'
  || parsed.pathname !== '/mybaby_agent_test' || parsed.port !== process.env.MYBABY_TEST_DB_PORT
  || !/^\d+$/.test(parsed.port) || Number(parsed.port) < 1024 || parsed.password.length < 32
  || !/^[a-f0-9]{64}$/.test(marker)
  || [...parsed.searchParams.keys()].some(key => !['schema', 'connection_limit', 'connect_timeout', 'pool_timeout'].includes(key))) {
  throw new Error('disposable_database_required')
}
const db = new PrismaClient({ datasources: { db: { url } } })
const store = prismaStore(db)
const identity = { source: 'weixin', botId: 'synthetic-pg-bot', userId: 'synthetic-user-a' } as const
const grant = (babyId = 'synthetic-baby-a', userId = identity.userId as string) => JSON.stringify([{ ...identity, userId, babyId }])
const request = (messageId: string) => ({ ...identity, messageId, operationKey: 'op_0',
  operation: 'create_growth_record', args: { date: '2026-10-10', weight: 10.5 } })
const options = (customStore = store, grants = grant()) => ({ store: customStore, grants, writesEnabled: true })
const isConflict = (error: unknown) => error instanceof ContractError && error.status === 409

before(async () => {
  const [server] = await db.$queryRaw<Array<{ database: string; role: string; address: string; directory: string }>>`
    SELECT current_database() AS database, current_user AS role,
      host(inet_server_addr()) AS address, current_setting('data_directory') AS directory`
  if (server.database !== 'mybaby_agent_test' || server.role !== 'mybaby_test' || server.address !== '127.0.0.1'
    || await realpath(server.directory) !== await realpath(directory)) throw new Error('database_instance_guard_failed')
  const rows = await db.$queryRaw<Array<{ token: string }>>`SELECT token FROM "_mybaby_test_guard"`
  if (rows.length !== 1 || rows[0].token !== marker) throw new Error('database_marker_guard_failed')
})
beforeEach(async () => {
  await db.agentOperation.deleteMany()
  await db.baby.deleteMany() // Cascades only after the disposable-instance guards.
  await db.baby.createMany({ data: ['a', 'b'].map(key => ({ id: `synthetic-baby-${key}`, name: `Synthetic Baby ${key}`,
    gender: 'girl', birthDate: new Date('2025-01-01T00:00:00Z'), notes: 'synthetic-private-note', allergies: 'synthetic-allergy' })) })
})
after(async () => { await db.$disconnect() })

function racedStore(participants = 2) {
  let arrivals = 0, mutations = 0, release!: () => void
  const ready = new Promise<void>(ok => { release = ok })
  const raced: AgentStore = { ...store, transaction: fn => store.transaction(tx => fn({ ...tx,
    async mutate(input, babyId) { const row = await tx.mutate(input, babyId); mutations++; return row },
    async saveReceipt(key, receipt) {
      arrivals++; if (arrivals === participants) release()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([ready, new Promise<void>((_ok, fail) => { timer = setTimeout(() => fail(new Error('race_barrier_timeout')), 3000) })])
      } finally { clearTimeout(timer) }
      await tx.saveReceipt(key, receipt)
    },
  })) }
  return { store: raced, mutations: () => mutations }
}

test('reviewed SQL creates the receipt table and PostgreSQL unique key rejects duplicates', async () => {
  const data = { source: identity.source, botId: identity.botId, messageId: 'schema-test', operationKey: 'op_0', payloadHash: 'synthetic', result: {} }
  await db.agentOperation.create({ data })
  await assert.rejects(db.agentOperation.create({ data }), error => store.isUniqueConflict(error))
  assert.equal(await db.agentOperation.count(), 1)
})

test('committed receipt replays through a fresh Prisma client without a second write', async () => {
  const first = await executeOperation(request('sequential'), options())
  const fresh = new PrismaClient({ datasources: { db: { url } } })
  try {
    const replay = await executeOperation(request('sequential'), options(prismaStore(fresh)))
    assert.equal(replay.data.id, first.data.id); assert.equal(replay.replayed, true)
    assert.equal(await db.growthRecord.count(), 1); assert.equal(await db.agentOperation.count(), 1)
  } finally { await fresh.$disconnect() }
})

test('same key with changed args conflicts; distinct operation keys commit separately', async () => {
  const input = request('keys')
  await executeOperation(input, options())
  await assert.rejects(executeOperation({ ...input, args: { ...input.args, weight: 11 } }, options()), isConflict)
  await executeOperation({ ...input, operationKey: 'op_1' }, options())
  assert.equal(await db.growthRecord.count(), 2); assert.equal(await db.agentOperation.count(), 2)
})

test('two transactions both mutate before receipt collision; loser mutation rolls back', async () => {
  const raced = racedStore(), input = request('concurrent-identical')
  const results = await Promise.all([executeOperation(input, options(raced.store)), executeOperation(input, options(raced.store))])
  assert.equal(raced.mutations(), 2)
  assert.equal(results[0].data.id, results[1].data.id)
  assert.equal(results.filter(result => result.replayed).length, 1)
  assert.equal(await db.growthRecord.count(), 1); assert.equal(await db.agentOperation.count(), 1)
})

test('concurrent changed payload rolls back loser and returns a 409 conflict', async () => {
  const raced = racedStore(), input = request('concurrent-conflict')
  const results = await Promise.allSettled([executeOperation(input, options(raced.store)),
    executeOperation({ ...input, args: { ...input.args, weight: 11 } }, options(raced.store))])
  assert.equal(raced.mutations(), 2)
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  const loser = results.find(r => r.status === 'rejected') as PromiseRejectedResult
  assert.ok(isConflict(loser.reason))
  assert.equal(await db.growthRecord.count(), 1); assert.equal(await db.agentOperation.count(), 1)
})

test('cross-tool concurrent key collision commits only one growth or milestone mutation', async () => {
  const raced = racedStore(), input = request('cross-tool')
  const results = await Promise.allSettled([executeOperation(input, options(raced.store)), executeOperation({ ...input,
    operation: 'create_milestone', args: { date: '2026-10-10', title: 'Synthetic first step' } }, options(raced.store))])
  assert.equal(raced.mutations(), 2)
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.ok(isConflict((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason))
  assert.equal(await db.growthRecord.count() + await db.milestone.count(), 1)
  assert.equal(await db.agentOperation.count(), 1)
})

test('real database receipt rejection rolls back growth and milestone business writes', async () => {
  // Static test-only DDL, guarded by the fresh instance/marker checks above.
  await db.$executeRawUnsafe(`CREATE FUNCTION "_agent_test_reject_receipt"() RETURNS trigger AS $$
    BEGIN IF NEW."messageId" LIKE 'rollback-%' THEN RAISE EXCEPTION 'synthetic receipt failure'; END IF; RETURN NEW; END;
    $$ LANGUAGE plpgsql`)
  await db.$executeRawUnsafe('CREATE TRIGGER "_agent_test_receipt_failure" BEFORE INSERT ON "agent_operations" FOR EACH ROW EXECUTE FUNCTION "_agent_test_reject_receipt"()')
  try {
    await assert.rejects(executeOperation(request('rollback-growth'), options()))
    await assert.rejects(executeOperation({ ...request('rollback-milestone'), operation: 'create_milestone',
      args: { date: '2026-10-10', title: 'Synthetic milestone' } }, options()))
    assert.equal(await db.growthRecord.count(), 0); assert.equal(await db.milestone.count(), 0)
    assert.equal(await db.agentOperation.count(), 0)
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER "_agent_test_receipt_failure" ON "agent_operations"')
    await db.$executeRawUnsafe('DROP FUNCTION "_agent_test_reject_receipt"()')
  }
  await executeOperation(request('rollback-growth'), options())
  assert.equal(await db.growthRecord.count(), 1)
})

test('revoked or remapped identity cannot retrieve a receipt or write a different baby', async () => {
  const input = request('grant-revalidation')
  await executeOperation(input, options())
  await assert.rejects(executeOperation(input, options(store, '[]')), e => e instanceof ContractError && e.status === 403)
  await assert.rejects(executeOperation(input, options(store, grant('synthetic-baby-b'))), isConflict)
  await assert.rejects(executeOperation({ ...input, userId: 'synthetic-user-b' }, options(store, grant('synthetic-baby-a', 'synthetic-user-b'))), isConflict)
  assert.equal(await db.growthRecord.count({ where: { babyId: 'synthetic-baby-b' } }), 0)
  assert.equal(await db.growthRecord.count(), 1)
})

test('reads are baby-scoped, UTC date-bounded, ordered and omit private fields', async () => {
  await db.growthRecord.createMany({ data: [
    { babyId: 'synthetic-baby-a', date: new Date('2026-10-09T00:00:00Z'), weight: 10, notes: 'synthetic-private-note' },
    { babyId: 'synthetic-baby-a', date: new Date('2026-10-10T23:59:59Z'), weight: 10.5 },
    { babyId: 'synthetic-baby-a', date: new Date('2026-10-11T00:00:00Z'), weight: 11 },
    { babyId: 'synthetic-baby-b', date: new Date('2026-10-10T00:00:00Z'), weight: 50 },
  ] })
  const result = await executeOperation({ ...request('read'), operation: 'list_growth_records',
    args: { from: '2026-10-09', to: '2026-10-10', limit: 1 } }, options())
  const records = result.data.records as Array<Record<string, unknown>>
  assert.equal(records.length, 1); assert.equal(records[0].weight, 10.5)
  assert.equal(records[0].date, '2026-10-10T23:59:59.000Z')
  assert.equal('notes' in records[0], false); assert.deepEqual(Object.keys(result.baby).sort(), ['birthDate', 'name'])
})

test('service cookie cannot authorize; writes-disabled and stranger requests leave PostgreSQL unchanged', async () => {
  const token = 'synthetic-service-token-'.padEnd(64, 'x')
  const disabled = agentHandler({ store, token, grants: grant(), writesEnabled: false })
  const enabled = agentHandler({ store, token, grants: grant(), writesEnabled: true })
  const call = (handler: typeof disabled, body: unknown, headers: Record<string, string>) => handler(new Request('https://example.invalid/api/agent/v1',
    { method: 'POST', headers, body: JSON.stringify(body) }))
  assert.equal((await call(enabled, request('cookie'), { cookie: 'mybaby_session=synthetic' })).status, 401)
  assert.equal((await call(disabled, request('disabled'), { authorization: `Bearer ${token}` })).status, 403)
  assert.equal((await call(enabled, { ...request('stranger'), userId: 'synthetic-stranger' }, { authorization: `Bearer ${token}` })).status, 403)
  assert.equal(await db.growthRecord.count(), 0); assert.equal(await db.agentOperation.count(), 0)
})
