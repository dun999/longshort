import { NextResponse, type NextRequest } from 'next/server';
import { GATE_CACHE, gateAccess, gateOrigin, gatePublicPath, safeNext } from './lib/gate';

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (gatePublicPath(path)) return NextResponse.next();
  const access = gateAccess(req.headers.get('cookie'));
  let response: NextResponse;
  if (access.allowed) response = NextResponse.next();
  else if (path.startsWith('/api/') || path === '/v1/graphql' || path === '/_next/image' || !['GET', 'HEAD'].includes(req.method)) {
    response = NextResponse.json({ error: 'Access code required', code: access.code }, { status: access.status });
  } else {
    const next = safeNext(path + req.nextUrl.search);
    response = NextResponse.redirect(new URL(`/gate?next=${encodeURIComponent(next)}`, gateOrigin(req.url)), 307);
  }
  response.headers.set('Cache-Control', GATE_CACHE);
  if (!access.allowed) response.headers.set('X-Longshort-Gate', access.code);
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export const config = { runtime: 'nodejs', matcher: ['/:path*'] };
