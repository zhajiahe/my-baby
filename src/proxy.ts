import { NextRequest, NextResponse } from 'next/server'
import { authConfig, authConfigured, sameOrigin, SESSION_COOKIE, validSession } from './lib/auth'

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  // The Agent route authenticates its independent service token in the handler.
  if (path === '/login' || path === '/api/auth/login' || path === '/api/auth/logout' || path === '/api/agent/v1') {
    return NextResponse.next()
  }
  const config = authConfig()
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }
  if (!authConfigured(config)) return NextResponse.json({ error: 'auth_not_configured' }, { status: 503, headers })
  if (!validSession(request.cookies.get(SESSION_COOKIE)?.value, config)) {
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers })
    const response = NextResponse.redirect(new URL('/login', request.url))
    response.headers.set('Cache-Control', 'no-store')
    return response
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !sameOrigin(request)) {
    return NextResponse.json({ error: 'invalid_origin' }, { status: 403, headers })
  }
  const response = NextResponse.next()
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Vary', 'Cookie')
  return response
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
