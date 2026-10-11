import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { authConfigured, createSession, validSession, sameOrigin, SESSION_COOKIE, SESSION_TTL } from '../src/lib/auth'
import { proxy } from '../src/proxy'

const config = { password: 'synthetic-family-password', secret: 's'.repeat(64) }

test('session is signed, expires and rotates with either password or secret', () => {
  const now = Date.now()
  const token = createSession(config, now)
  assert.ok(validSession(token, config, now))
  assert.ok(!validSession(token + 'changed', config, now))
  assert.ok(!validSession(token, config, now + SESSION_TTL * 1000 + 1))
  assert.ok(!validSession(token, { ...config, password: 'different-family-password' }, now))
  assert.ok(!validSession(token, { ...config, secret: 't'.repeat(64) }, now))
  assert.ok(!authConfigured({}))
  assert.ok(!validSession(token, {}, now))
  assert.throws(() => createSession({}))
})

test('CSRF origin rejects missing, unrelated and malformed origins', () => {
  assert.ok(sameOrigin(new Request('https://test.example/path', { headers: { origin: 'https://test.example' } })))
  assert.ok(!sameOrigin(new Request('https://test.example/path')))
  assert.ok(!sameOrigin(new Request('https://test.example/path', { headers: { origin: 'https://evil.example' } })))
  assert.ok(!sameOrigin(new Request('https://test.example/path', { headers: { origin: 'null' } })))
})

test('proxy protects original APIs, cookie cannot authorize service API and writes need same origin', async t => {
  const prior = { password: process.env.MYBABY_APP_PASSWORD, secret: process.env.MYBABY_SESSION_SECRET }
  t.after(() => {
    for (const [name, value] of [['MYBABY_APP_PASSWORD', prior.password], ['MYBABY_SESSION_SECRET', prior.secret]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value
    }
  })
  process.env.MYBABY_APP_PASSWORD = config.password; process.env.MYBABY_SESSION_SECRET = config.secret
  assert.equal(proxy(new NextRequest('https://test/api/baby')).status, 401)
  assert.equal(proxy(new NextRequest('https://test/api/photos/upload', { method: 'POST' })).status, 401)
  // Media intake authenticates with the service token in the route, so the proxy
  // must not demand a family cookie for it.
  assert.equal(proxy(new NextRequest('https://test/api/agent/media', { method: 'POST' })).status, 200)
  assert.equal(proxy(new NextRequest('https://test/')).status, 307)
  const cookie = `${SESSION_COOKIE}=${createSession(config)}`
  assert.equal(proxy(new NextRequest('https://test/api/baby', { headers: { cookie } })).status, 200)
  assert.equal(proxy(new NextRequest('https://test/api/baby', { method: 'POST', headers: { cookie, origin: 'https://evil' } })).status, 403)
  assert.equal(proxy(new NextRequest('https://test/api/baby', { method: 'POST', headers: { cookie, origin: 'https://test' } })).status, 200)
  process.env.MYBABY_WRITES_FROZEN='true'
  try {
    assert.equal(proxy(new NextRequest('https://test/api/agent/v1',{method:'POST'})).status,503)
    assert.equal(proxy(new NextRequest('https://test/api/photos/generate-upload-url',{method:'POST',headers:{cookie,origin:'https://test'}})).status,503)
    // The freeze is a business write switch, so channel media intake is blocked too.
    assert.equal(proxy(new NextRequest('https://test/api/agent/media',{method:'POST'})).status,503)
    assert.equal(proxy(new NextRequest('https://test/api/baby',{headers:{cookie}})).status,200)
    assert.equal(proxy(new NextRequest('https://test/api/auth/logout',{method:'POST'})).status,200)
    // Only the independently token-authenticated cleanup route bypasses business freeze.
    assert.equal(proxy(new NextRequest('https://test/api/migration/cleanup-test-media',{method:'POST'})).status,200)
    assert.equal(proxy(new NextRequest('https://test/api/migration/copy-media',{method:'POST'})).status,503)
  } finally {delete process.env.MYBABY_WRITES_FROZEN}
  delete process.env.MYBABY_APP_PASSWORD
  assert.equal(proxy(new NextRequest('https://test/api/baby')).status, 503)
})
