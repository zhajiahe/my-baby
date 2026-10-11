import { NextRequest, NextResponse } from 'next/server'
import { authConfig, authConfigured, sameOrigin, SESSION_COOKIE, validSession } from './lib/auth'

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const isolate = (response: NextResponse) => {
    response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
    return response
  }
  // Freeze mutations before independent Agent authorization too. Already-issued
  // R2 signatures expire separately; wait their TTL and drain uploads at cutover.
  if(process.env.MYBABY_WRITES_FROZEN === 'true' && path.startsWith('/api/')
    && !path.startsWith('/api/auth/') && path !== '/api/migration/cleanup-test-media'
    && !['GET','HEAD','OPTIONS'].includes(request.method)) {
    return NextResponse.json({error:'writes_frozen'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'60'}})
  }
  // Agent, operations and temporary migration routes authenticate independent service tokens.
  if (path === '/login' || path === '/api/auth/login' || path === '/api/auth/logout' || path === '/api/agent/v1' || path === '/api/agent/media' || path === '/api/ops/health' || path === '/api/migration/copy-media' || path === '/api/migration/cleanup-test-media') {
    return isolate(NextResponse.next())
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
  return isolate(response)
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
