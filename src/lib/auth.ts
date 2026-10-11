import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'mybaby_session'
export const SESSION_TTL = 7 * 24 * 60 * 60
export interface AuthConfig { password?: string; secret?: string }
export function authConfig(): AuthConfig { return { password: process.env.MYBABY_APP_PASSWORD, secret: process.env.MYBABY_SESSION_SECRET } }
// Family password minimum is deliberately 6 (owner decision, 2026-10-11). The session
// signing secret keeps its >=32 requirement; a 6-digit password relies on the login
// rate limit, which is still best-effort per instance and needs a distributed WAF limit.
export function authConfigured(config: AuthConfig): boolean { return (config.password?.length ?? 0) >= 6 && (config.secret?.length ?? 0) >= 32 }
export function equalSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}
function signingKey(config: AuthConfig): Buffer {
  // Rotating either the shared password or signing secret invalidates all cookies.
  return createHmac('sha256', config.secret!).update(config.password!).digest()
}
export function createSession(config: AuthConfig, now = Date.now()): string {
  if (!authConfigured(config)) throw new Error('auth_not_configured')
  const payload = Buffer.from(JSON.stringify({ v: 1, exp: now + SESSION_TTL * 1000, nonce: randomBytes(16).toString('hex') })).toString('base64url')
  return `${payload}.${createHmac('sha256', signingKey(config)).update(payload).digest('base64url')}`
}
export function validSession(token: string | undefined, config: AuthConfig, now = Date.now()): boolean {
  if (!token || token.length > 512 || !authConfigured(config)) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payload, signature] = parts
  const expected = createHmac('sha256', signingKey(config)).update(payload).digest('base64url')
  if (!equalSecret(signature, expected)) return false
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return body.v === 1 && typeof body.nonce === 'string' && typeof body.exp === 'number'
      && body.exp > now && body.exp <= now + SESSION_TTL * 1000
  } catch { return false }
}
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  try { return new URL(origin).origin === new URL(process.env.MYBABY_APP_ORIGIN?.trim() || request.url).origin }
  catch { return false }
}
export async function limitedJson(request: Request, maxBytes = 16_384): Promise<unknown> {
  if (!request.body) throw new Error('invalid_body')
  const reader = request.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxBytes) { await reader.cancel(); throw new Error('invalid_body') }
    chunks.push(value)
  }
  const body = Buffer.concat(chunks)
  return JSON.parse(body.toString('utf8'))
}

// Best-effort per-instance protection only. Production needs a distributed WAF
// rate limit at /api/auth/login; do not describe this as a global guarantee.
const attempts = new Map<string, { count: number; expires: number }>()
let globalAttempts = { count: 0, expires: 0 }
export function loginAllowed(request: Request, now = Date.now()): boolean {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const key = createHash('sha256').update(ip).digest('hex')
  if (globalAttempts.expires <= now) globalAttempts = { count: 0, expires: now + 60_000 }
  if (++globalAttempts.count > 30) return false
  if (attempts.size > 5000) for (const [id, v] of attempts) if (v.expires <= now) attempts.delete(id)
  if (attempts.size > 5000 && !attempts.has(key)) return false
  const value = attempts.get(key)
  const bucket = value && value.expires > now ? value : { count: 0, expires: now + 15 * 60_000 }
  bucket.count++; attempts.set(key, bucket)
  return bucket.count <= 5
}
