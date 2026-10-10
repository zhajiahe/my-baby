import { NextResponse } from 'next/server'
import { sameOrigin, SESSION_COOKIE } from '@/lib/auth'

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict', path: '/', maxAge: 0 })
  return response
}
