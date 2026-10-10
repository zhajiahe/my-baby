import { NextResponse } from 'next/server'
import { authConfig, authConfigured, createSession, equalSecret, limitedJson, loginAllowed, sameOrigin, SESSION_COOKIE, SESSION_TTL } from '@/lib/auth'

export const runtime = 'nodejs'
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  if (!sameOrigin(request)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403, headers })
  const config = authConfig()
  if (!authConfigured(config)) return NextResponse.json({ error: 'auth_not_configured' }, { status: 503, headers })
  if (!loginAllowed(request)) return NextResponse.json({ error: 'too_many_attempts' }, { status: 429, headers: { ...headers, 'Retry-After': '900' } })
  let body: unknown
  try { body = await limitedJson(request, 4096) } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers }) }
  const password = (body as { password?: unknown } | null)?.password
  if (typeof password !== 'string' || password.length > 1024 || !equalSecret(password, config.password!)) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401, headers })
  }
  const response = NextResponse.json({ ok: true }, { headers })
  response.cookies.set(SESSION_COOKIE, createSession(config), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: SESSION_TTL,
  })
  return response
}
