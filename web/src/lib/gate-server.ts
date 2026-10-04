import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { gateAccess, gateCookie, safeNext } from './gate';

/** Also check at server-render/data boundaries, independently of middleware. */
export async function requireGate(next = '/') {
  const cookie = (await headers()).get('cookie');
  const access = gateAccess(cookie);
  if (!access.allowed) redirect(`/gate?next=${encodeURIComponent(safeNext(next))}`);
  return { token: gateCookie(cookie), expiresAt: access.expiresAt };
}
