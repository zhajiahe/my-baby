// Disposable local PostgreSQL only. Never accepts the application's DATABASE_URL.
import { randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { access, chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { createServer } from 'node:net'

async function binaries(): Promise<string> {
  const candidates = [process.env.MYBABY_TEST_PG_BIN, '/opt/homebrew/opt/postgresql@14/bin',
    ...[18, 17, 16, 15, 14].map(v => `/usr/lib/postgresql/${v}/bin`), ...(process.env.PATH ?? '').split(delimiter)]
  for (const dir of candidates) {
    if (!dir) continue
    try { await Promise.all(['initdb', 'pg_ctl', 'psql', 'createdb'].map(name => access(join(dir, name), constants.X_OK))); return dir } catch {}
  }
  throw new Error('local_postgres_tools_missing: set MYBABY_TEST_PG_BIN to a local PostgreSQL bin directory')
}
async function port(): Promise<number> {
  const server = createServer()
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('port_allocation_failed')
  await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok()))
  return address.port
}

async function main() {
  const bin = await binaries()
  const dir = await mkdtemp(join(tmpdir(), 'mybaby-agent-pg-'))
  await chmod(dir, 0o700)
  const data = join(dir, 'data'), socket = join(dir, 'socket'), passwordFile = join(dir, 'password')
  // initdb creates its data directory, but the socket directory must exist first.
  const { mkdir } = await import('node:fs/promises')
  await mkdir(socket, { mode: 0o700 })
  const password = randomBytes(32).toString('hex'), marker = randomBytes(32).toString('hex')
  const pgPort = await port()
  const url = `postgresql://mybaby_test:${password}@127.0.0.1:${pgPort}/mybaby_agent_test?schema=public&connection_limit=16&connect_timeout=3&pool_timeout=10`
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url, MYBABY_TEST_DATABASE_URL: url, MYBABY_TEST_DB_MARKER: marker,
    MYBABY_TEST_DB_DIR: data, MYBABY_TEST_DB_PORT: String(pgPort) }
  // libpq service/host overrides must never redirect a local test elsewhere.
  for (const key of Object.keys(env)) if (key.startsWith('PG')) delete env[key]
  Object.assign(env, { PGHOST: '127.0.0.1', PGPORT: String(pgPort), PGUSER: 'mybaby_test', PGPASSWORD: password, PGDATABASE: 'postgres' })
  await writeFile(passwordFile, password, { mode: 0o600 })
  const redact = (text: string) => [url, password, marker].reduce((out, value) => out.split(value).join('[redacted]'), text)
  let started = false, stopped = false, succeeded = false, interrupted = false
  let activeChild: ChildProcess | undefined
  const interrupt = () => { interrupted = true; activeChild?.kill('SIGTERM') }
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
  async function run(label: string, command: string, args: string[], timeoutMs = 60_000): Promise<string> {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((ok, fail) => {
      const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
      activeChild = child
      let stdout = '', stderr = ''
      const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      child.once('error', error => { clearTimeout(timer); fail(error) })
      child.once('close', code => { clearTimeout(timer); activeChild = undefined; ok({ code, stdout, stderr }) })
    })
    await writeFile(join(dir, `${label}.log`), redact(result.stdout + result.stderr), { mode: 0o600 })
    if (interrupted && label !== 'stop') throw new Error('integration_interrupted')
    if (result.code !== 0) throw new Error(`${label}_failed; private diagnostic directory: ${dir}`)
    return result.stdout
  }
  const psql = ['-X', '--host=127.0.0.1', `--port=${pgPort}`, '--username=mybaby_test', '--dbname=postgres', '-v', 'ON_ERROR_STOP=1']
  try {
    await run('init', join(bin, 'initdb'), ['-D', data, '--username=mybaby_test', '--auth-host=scram-sha-256',
      '--auth-local=trust', `--pwfile=${passwordFile}`, '--encoding=UTF8', '--locale=C'])
    // Bind only to loopback, use a fresh private data directory and socket.
    await run('start', join(bin, 'pg_ctl'), ['-D', data, '-l', join(dir, 'postgres.log'), '-w', 'start', '-o', `-h 127.0.0.1 -p ${pgPort} -k ${socket}`])
    started = true
    const actual = (await run('ownership', join(bin, 'psql'), [...psql, '-At', '-c', 'SHOW data_directory'])).trim()
    if (await realpath(actual) !== await realpath(data)) throw new Error('unexpected_postgres_instance')
    await run('create', join(bin, 'createdb'), ['--host=127.0.0.1', `--port=${pgPort}`, '--username=mybaby_test', 'mybaby_agent_test'])

    const schema = await readFile('prisma/schema.prisma', 'utf8')
    const baseline = schema.replace(/\nmodel AgentOperation \{[\s\S]*?\n\}/, '')
    if (baseline === schema || baseline.includes('\nmodel AgentOperation')) throw new Error('baseline_schema_invalid')
    const baselineFile = join(dir, 'baseline.prisma'), sqlFile = join(dir, 'baseline.sql')
    await writeFile(baselineFile, baseline, { mode: 0o600 })
    const prisma = resolve('node_modules/prisma/build/index.js')
    const sql = await run('baseline-diff', process.execPath, [prisma, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', baselineFile, '--script'])
    await writeFile(sqlFile, sql, { mode: 0o600 })
    const databasePsql = psql.map(arg => arg === '--dbname=postgres' ? '--dbname=mybaby_agent_test' : arg)
    await run('baseline-apply', join(bin, 'psql'), [...databasePsql, '-f', sqlFile])
    await run('additive-apply', join(bin, 'psql'), [...databasePsql, '-f', resolve('prisma/changes/20261010_agent_operations.sql')])
    // Prove the reviewed additive SQL matches the full Prisma schema before
    // introducing the test-only guard table (which would intentionally drift).
    await run('schema-match', process.execPath, [prisma, 'migrate', 'diff', '--from-schema-datasource', resolve('prisma/schema.prisma'),
      '--to-schema-datamodel', resolve('prisma/schema.prisma'), '--exit-code'])
    const guardFile = join(dir, 'guard.sql')
    await writeFile(guardFile, `CREATE TABLE "_mybaby_test_guard" (token TEXT NOT NULL); INSERT INTO "_mybaby_test_guard" VALUES ('${marker}');`, { mode: 0o600 })
    await run('guard', join(bin, 'psql'), [...databasePsql, '-f', guardFile])
    console.log('Fresh loopback PostgreSQL initialized; baseline + additive SQL match Prisma. No production connection used.')
    const report = await run('integration', process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1',
      '--test-timeout=30000', 'tests/integration/agent-postgres.test.ts'], 120_000)
    console.log(redact(report))
    succeeded = true
  } finally {
    if (!started) {
      try { await access(join(data, 'postmaster.pid')); started = true } catch {}
    }
    if (started) {
      await run('stop', join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'])
      stopped = true
    }
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt)
    if (succeeded && stopped) { await rm(dir, { recursive: true, force: true }); console.log('Disposable PostgreSQL stopped and test data removed.') }
    else console.log(`Private diagnostics retained: ${dir}; cluster ${stopped ? 'stopped' : 'not confirmed stopped'}.`)
  }
}
main().catch(error => {
  // Never print Prisma/connection exceptions, URLs or generated credentials.
  console.error(error instanceof Error && /^[a-z_]+(?:; private diagnostic directory: \/[^\n]+)?$/.test(error.message)
    ? error.message : 'postgres_integration_failed; inspect private diagnostics or local tool availability')
  process.exitCode = 1
})
