import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { gateAccess } from '@longshort/shared/gate';
export * from '@longshort/shared/gate';

export function gateAllows(req: Pick<IncomingMessage, 'headers'>) {
  return gateAccess(req.headers.cookie).allowed;
}

/** A successful upgrade does not authorize a socket forever. */
export function watchGateSocket(ws: WebSocket, req: Pick<IncomingMessage, 'headers'>) {
  const access = gateAccess(req.headers.cookie);
  const check = () => { if (!gateAllows(req)) ws.close(4001, 'Access code required'); };
  const expiry = access.expiresAt ? setTimeout(check, Math.max(0, access.expiresAt - Date.now())) : undefined;
  const rotation = setInterval(check, 30_000);
  expiry?.unref();
  rotation.unref();
  ws.once('close', () => { clearTimeout(expiry); clearInterval(rotation); });
  check();
}
