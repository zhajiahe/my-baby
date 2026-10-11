import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContractError, validateRequest, resolveGrant, mediaNamespace, isModelOperation, MODEL_OPERATIONS } from '../shared/agent'
import { agentHandler } from '../src/lib/agent/handler'
import { executeOperation, type AgentResult, type AgentStore, type Receipt, type ReceiptKey } from '../src/lib/agent/service'

const grants = JSON.stringify([{ source: 'weixin', botId: 'bot', userId: 'allowed', babyId: 'baby-allowed' }])
const request = { source: 'weixin', botId: 'bot', userId: 'allowed', messageId: 'message-1',
  operation: 'create_growth_record', operationKey: 'op_0', args: { date: '2026-10-10', weight: 10.5 } }

class UniqueConflict extends Error {}
function memoryStore() {
  const receipts = new Map<string, Receipt>()
  const records: Record<string, unknown>[] = []
  const keyOf = (key: ReceiptKey) => JSON.stringify(key)
  let failReceipt = false
  const store: AgentStore = {
    async baby(babyId) { assert.equal(babyId, 'baby-allowed'); return { name: '测试宝宝', birthDate: '2025-01-01' } },
    async growth(babyId) { assert.equal(babyId, 'baby-allowed'); return records },
    async media(babyId) { assert.equal(babyId, 'baby-allowed');
      return [{ date: '2026-10-11T00:00:00.000Z', mediaType: 'IMAGE', format: 'jpg', title: '满月' }] },
    async album(babyId) { assert.equal(babyId, 'baby-allowed');
      return { total: 3, images: 2, videos: 1, firstDate: '2026-08-01', latestDate: '2026-10-11', months: [{ month: '2026-10', count: 2 }] } },
    async findReceipt(key) { return receipts.get(keyOf(key)) ?? null },
    async transaction(fn) {
      const writes: Record<string, unknown>[] = []
      const pending = new Map<string, Receipt>()
      const snapshot = new Map(receipts)
      const result = await fn({
        async findReceipt(key) { return snapshot.get(keyOf(key)) ?? null },
        async mutate(input, babyId) {
          assert.equal(babyId, 'baby-allowed')
          const value = { id: `record-${crypto.randomUUID()}`, ...input.args }
          writes.push(value); return value
        },
        async saveReceipt(key, receipt) {
          if (failReceipt) throw new Error('injected_commit_failure')
          pending.set(keyOf(key), receipt)
        },
      })
      if ([...pending.keys()].some(key => receipts.has(key))) throw new UniqueConflict()
      for (const [key, receipt] of pending) receipts.set(key, receipt)
      records.push(...writes)
      return result
    },
    isUniqueConflict(error) { return error instanceof UniqueConflict },
  }
  return { store, records, failReceipt(value: boolean) { failReceipt = value } }
}

test('album reads are bounded, require no write switch and never expose media URLs', async () => {
  const { store, records } = memoryStore()
  const list = await executeOperation({ ...request, operation: 'list_media_items', operationKey: 'op_0', args: { limit: 5, mediaType: 'IMAGE' } },
    { store, grants, writesEnabled: false })
  assert.equal(list.operation, 'list_media_items'); assert.equal(list.baby.name, '测试宝宝')
  assert.equal((list.data.records as unknown[]).length, 1)
  assert.ok(!JSON.stringify(list).includes('/api/media'), 'private media URLs must never reach the channel')
  const album = await executeOperation({ ...request, operation: 'get_album_summary', operationKey: 'op_1', args: {} },
    { store, grants, writesEnabled: false })
  assert.deepEqual(album.data, { total: 3, images: 2, videos: 1, firstDate: '2026-08-01', latestDate: '2026-10-11', months: [{ month: '2026-10', count: 2 }] })
  assert.equal(records.length, 0, 'reads must never mutate')
})

test('album arguments reject unbounded, mistyped, reversed-range and unknown fields', () => {
  const call = (operation: string, args: unknown) => () => validateRequest({ ...request, operation, args })
  assert.throws(call('list_media_items', { limit: 31 }))
  assert.throws(call('list_media_items', { limit: 0 }))
  assert.throws(call('list_media_items', { limit: 1.5 }))
  assert.throws(call('list_media_items', { mediaType: 'AUDIO' }))
  assert.throws(call('list_media_items', { from: '2026-02-30' }))
  assert.throws(call('list_media_items', { from: '2026-10-10', to: '2026-10-01' }))
  assert.throws(call('list_media_items', { from: '2026-10-10', url: '/api/media/legacy/x.jpg' }))
  assert.throws(call('get_album_summary', { from: '2026-10-10' }))
  assert.throws(call('get_album_summary', { babyId: 'other' }))
  assert.deepEqual(validateRequest({ ...request, operation: 'list_media_items', args: { limit: 5, mediaType: 'VIDEO' } }).args,
    { limit: 5, mediaType: 'VIDEO' })
  assert.deepEqual(validateRequest({ ...request, operation: 'list_media_items', args: {} }).args, { limit: 10 })
})

test('media archive keys are bound to the authenticated identity namespace', () => {
  const namespace = mediaNamespace('bot', 'allowed');
  const key = `${namespace}123-0.jpg`, thumb = `${namespace}123-0-thumb.jpg`, video = `${namespace}123-1.mp4`;
  const call = (args: unknown, identity: { botId: string; userId: string } = { botId: 'bot', userId: 'allowed' }) =>
    validateRequest({ source: 'weixin', ...identity, messageId: '123', operation: 'create_media_record', operationKey: 'op_0', args });
  assert.equal(call({ date: '2026-10-11', key, mediaType: 'IMAGE', title: '满月' }).args.key, key);
  // A well-formed key from someone else's namespace is refused outright.
  for (const args of [
    { date: '2026-10-11', key: `${mediaNamespace('bot', 'stranger')}123-0.jpg`, mediaType: 'IMAGE' },
    { date: '2026-10-11', key: video, mediaType: 'VIDEO', thumbnailKey: `${mediaNamespace('bot', 'stranger')}123-0-thumb.jpg` },
  ]) assert.throws(() => call(args), (error: unknown) => error instanceof ContractError && error.status === 403);
  // Shape violations: prefix, extension, index bound, URL form and query tricks.
  for (const invalid of ['uploads/wx/zzz/123-0.jpg', `${namespace}123-0.exe`, `uploads/wx/${'a'.repeat(16)}/123-9.jpg`,
    `/api/media/${key}`, `${key}?x=1`, `${namespace}../../etc/passwd.jpg`, `${namespace}123-0.JPG`.replace('.JPG', '.jpg/../x.jpg')]) {
    assert.throws(() => call({ date: '2026-10-11', key: invalid, mediaType: 'IMAGE' }));
  }
  assert.throws(() => call({ date: '2026-10-11', key, mediaType: 'VIDEO' }), /media_type_mismatch/);
  assert.throws(() => call({ date: '2026-10-11', key: video, mediaType: 'IMAGE' }), /media_type_mismatch/);
  const video_ = call({ date: '2026-10-11', key: video, mediaType: 'VIDEO', duration: 12.6, thumbnailKey: thumb });
  assert.equal(video_.args.duration, 13);
  assert.throws(() => call({ date: '2026-10-11', key: video, mediaType: 'VIDEO', thumbnailKey: `${namespace}123-1.jpg` }), /invalid_thumbnail_key/);
  assert.throws(() => call({ date: '2026-10-11', key, mediaType: 'IMAGE', thumbnailKey: thumb }), /invalid_thumbnail_key/);
  assert.throws(() => call({ date: '2026-10-11', key: video, mediaType: 'VIDEO', duration: 4000 }), /invalid_duration/);
  assert.throws(() => call({ date: '2026-02-30', key, mediaType: 'IMAGE' }));
  assert.throws(() => call({ date: '2026-10-11', key, mediaType: 'IMAGE', url: '/api/media/evil.jpg' }));
  assert.throws(() => call({ date: '2026-10-11', key, mediaType: 'AUDIO' }));
  // Media archiving is channel-driven, never model-driven.
  assert.ok(!MODEL_OPERATIONS.includes('create_media_record'));
  assert.equal(isModelOperation('create_media_record'), false);
  assert.equal(isModelOperation('delete_baby'), false);
  assert.equal(isModelOperation('create_milestone'), true);
});

test('object verification runs once before commit and never on replay', async () => {
  const { store, records } = memoryStore();
  let verifications = 0;
  const verifyWrite = async () => { verifications++; };
  const mediaRequest = { ...request, operation: 'create_media_record', operationKey: 'op_0',
    args: { date: '2026-10-11', key: `${mediaNamespace('bot', 'allowed')}123-0.jpg`, mediaType: 'IMAGE' } };
  await executeOperation(mediaRequest, { store, grants, writesEnabled: true, verifyWrite });
  assert.equal(verifications, 1);
  const replay = await executeOperation(mediaRequest, { store, grants, writesEnabled: true, verifyWrite });
  assert.ok(replay.replayed); assert.equal(verifications, 1, 'a replay must not re-verify a stored object');
  assert.equal(records.length, 1);
});

test('missing stored objects block the commit, leave no receipt and stay retryable', async () => {
  const { store, records } = memoryStore();
  const mediaRequest = { ...request, operation: 'create_media_record', operationKey: 'op_0',
    args: { date: '2026-10-11', key: `${mediaNamespace('bot', 'allowed')}123-0.jpg`, mediaType: 'IMAGE' } };
  await assert.rejects(executeOperation(mediaRequest, { store, grants, writesEnabled: true,
    verifyWrite: async () => { throw new ContractError('upload_not_complete', 409); } }), /upload_not_complete/);
  assert.equal(records.length, 0);
  await assert.rejects(executeOperation(mediaRequest, { store, grants, writesEnabled: false, verifyWrite: async () => {} }), /writes_disabled/);
  const accepted = await executeOperation(mediaRequest, { store, grants, writesEnabled: true, verifyWrite: async () => {} });
  assert.equal(records.length, 1); assert.equal(accepted.replayed, undefined);
});

test('grants are mandatory, unambiguous and identity-specific; model cannot pass babyId', () => {
  assert.throws(() => resolveGrant(request as never, undefined), (e: unknown) => e instanceof ContractError && e.status === 503)
  assert.throws(() => resolveGrant({ ...request, userId: 'stranger' } as never, grants), (e: unknown) => e instanceof ContractError && e.status === 403)
  assert.throws(() => resolveGrant(request as never, `[${JSON.parse(grants).map((g: object) => JSON.stringify(g)).join(',')},${JSON.stringify(JSON.parse(grants)[0])}]`))
  assert.throws(() => validateRequest({ ...request, args: { ...request.args, babyId: 'other-baby' } }))
  assert.throws(() => validateRequest({ ...request, babyId: 'other-baby' }))
})

test('all operations reject invalid dates, units/types and arbitrary tools before mutation', () => {
  for (const args of [{ date: '2026-02-30', weight: 10 }, { date: '2026-10-10', weight: '10.5' },
    { date: '2026-10-10', weight: -1 }, { date: '2026-10-10' }]) assert.throws(() => validateRequest({ ...request, args }))
  assert.throws(() => validateRequest({ ...request, operation: 'delete_baby', args: {} }))
})

test('duplicate write returns the committed result, changed payload gets 409', async () => {
  const { store, records } = memoryStore()
  const first = await executeOperation(request, { store, grants, writesEnabled: true })
  const replay = await executeOperation(request, { store, grants, writesEnabled: true })
  assert.equal(records.length, 1); assert.equal(first.data.id, replay.data.id); assert.ok(replay.replayed)
  await assert.rejects(executeOperation({ ...request, args: { ...request.args, weight: 11 } }, { store, grants, writesEnabled: true }),
    (e: unknown) => e instanceof ContractError && e.status === 409)
  assert.equal(records.length, 1)
})

test('same-type operations use stable distinct keys; concurrent identical writes commit once', async () => {
  const { store, records } = memoryStore()
  const results = await Promise.all([executeOperation(request, { store, grants, writesEnabled: true }),
    executeOperation(request, { store, grants, writesEnabled: true })])
  assert.equal(records.length, 1); assert.equal(results[0].data.id, results[1].data.id)
  await executeOperation({ ...request, operationKey: 'op_1' }, { store, grants, writesEnabled: true })
  assert.equal(records.length, 2)
})

test('receipt insertion failure rolls back business mutation', async () => {
  const h = memoryStore(); h.failReceipt(true)
  await assert.rejects(executeOperation(request, { store: h.store, grants, writesEnabled: true }))
  assert.equal(h.records.length, 0)
  h.failReceipt(false)
  await executeOperation(request, { store: h.store, grants, writesEnabled: true })
  assert.equal(h.records.length, 1)
})

test('service authentication separate from cookie; writes disabled by default; private caching', async () => {
  const h = memoryStore(), token = 't'.repeat(64)
  const handler = agentHandler({ store: h.store, token, grants, writesEnabled: false })
  const call = (body: unknown, headers: Record<string, string> = {}) => handler(new Request('https://test/api/agent/v1', {
    method: 'POST', headers, body: JSON.stringify(body),
  }))
  assert.equal((await call(request, { cookie: 'mybaby_session=any' })).status, 401)
  assert.equal((await call(request, { authorization: `Bearer ${token}` })).status, 403)
  assert.equal(h.records.length, 0)
  const response = await call({ ...request, operation: 'get_baby_summary', args: {} }, { authorization: `Bearer ${token}` })
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store')
  const result = await response.json() as AgentResult
  assert.equal(result.baby.name, '测试宝宝')
})
