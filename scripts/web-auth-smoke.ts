import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import assert from 'node:assert/strict'

async function main() {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  const password = 'synthetic-smoke-password', token = 't'.repeat(64)
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port), '-H', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, MYBABY_APP_PASSWORD: password, MYBABY_SESSION_SECRET: 's'.repeat(64), MYBABY_APP_ORIGIN: origin,
      MYBABY_AGENT_TOKEN: token, MYBABY_AGENT_GRANTS: '[]', MYBABY_AGENT_WRITES_ENABLED: 'false',
      // Override any real .env database. This smoke test must never touch Neon.
      DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/synthetic?connect_timeout=1',
    },
  })
  // Consume output without printing it; assertions, not server logs, are the evidence.
  child.stdout?.resume(); child.stderr?.resume()
  let launchError: unknown
  child.on('error', error => { launchError = error })
  const call = (path: string, init: RequestInit = {}) => fetch(origin + path, { ...init, redirect: 'manual' })
  try {
    let ready = false
    for (let i = 0; i < 100; i++) {
      try { if ((await call('/login')).status === 200) { ready = true; break } } catch { /* startup */ }
      if (launchError || child.exitCode !== null) throw new Error('smoke_server_failed')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(ready)
    assert.equal((await call('/')).status, 307)
    for (const path of ['/api/baby', '/api/growth-records', '/api/milestones', '/api/photos']) assert.equal((await call(path)).status, 401)
    assert.equal((await call('/api/photos/upload', { method: 'POST' })).status, 401)
    assert.equal((await call('/api/auth/login', { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403)
    const login = await call('/api/auth/login', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
    assert.equal(login.status, 200)
    const header = login.headers.get('set-cookie')!
    assert.ok(header.includes('HttpOnly')); assert.ok(header.includes('Secure')); assert.ok(/SameSite=strict/i.test(header))
    const cookie = header.split(';')[0]
    const home = await call('/', { headers: { cookie } })
    assert.equal(home.status, 200); assert.ok(home.headers.get('cache-control')?.includes('no-store'))
    assert.equal((await call('/api/baby', { method: 'POST', headers: { cookie, origin: 'https://evil.example' } })).status, 403)
    const body = { source: 'weixin', botId: 'synthetic-bot', userId: 'synthetic-user', messageId: '1',
      operation: 'get_baby_summary', operationKey: 'scope', args: {} }
    assert.equal((await call('/api/agent/v1', { method: 'POST', headers: { cookie }, body: JSON.stringify(body) })).status, 401)
    assert.equal((await call('/api/agent/v1', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) })).status, 403)
    const logout = await call('/api/auth/logout', { method: 'POST', headers: { origin, cookie } })
    assert.equal(logout.status, 200); assert.ok(logout.headers.get('set-cookie')?.includes('Max-Age=0'))
    assert.equal((await call('/api/baby')).status, 401)
    console.log('Production-build HTTP auth smoke passed: login, proxy, CSRF, service auth and logout. Production database calls: 0.')
  } finally {
    child.kill('SIGTERM')
    if (child.exitCode === null) await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 5000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
}
main().catch(() => { console.error('web_auth_smoke_failed'); process.exitCode = 1 })
