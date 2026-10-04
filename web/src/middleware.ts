import { NextResponse, type NextRequest } from 'next/server';
import { GATE_CACHE, gateAccess, gateOrigin, gatePublicPath, safeNext } from './lib/gate';
import { ASSET_CACHE, currentAsset } from './lib/asset';

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
  // A content-hashed media file may stay in the browser that fetched it with a valid session (private: never
  // in a shared cache). Everything else, and every refusal, is no-store. See lib/asset.ts.
  response.headers.set('Cache-Control', access.allowed && currentAsset(path, req.nextUrl.searchParams.get('v')) ? ASSET_CACHE : GATE_CACHE);
  if (!access.allowed) response.headers.set('X-Longshort-Gate', access.code);
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export const config = { runtime: 'nodejs', matcher: ['/:path*'] };
