import { NextResponse, type NextRequest } from 'next/server';
import { GATE_COOKIE, gatePassword, gateToken, sameSecret } from '@/lib/gate';

export function middleware(req: NextRequest) {
  const pw = gatePassword();
  if (!pw) return NextResponse.next();
  const have = req.cookies.get(GATE_COOKIE)?.value ?? '';
  if (have && sameSecret(have, gateToken(pw))) return NextResponse.next();
  // absolute URL on the public origin (Caddy forwards the original host and scheme)
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  const url = new URL(`/gate?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`, `${proto}://${host}`);
  return NextResponse.redirect(url, 307);
}

export const config = {
  runtime: 'nodejs',
  // shared results (/s/…) stay public so X, Telegram, WhatsApp… can read the card behind the gate
  matcher: ['/((?!_next/static|_next/image|gate|s/|manifest\\.webmanifest|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|txt)$).*)'],
};
