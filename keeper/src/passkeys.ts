import { isAddress, zeroAddress } from 'viem';
import { ADDR } from '@longshort/shared';
import { signedIn } from './auth';
import { db } from './db';

/** Public derivation hints only. The browser must verify the derived signer against the onchain seat. */
export function saveMatchKey(body: unknown) {
  const owner = signedIn(body);
  const { session, label, chainId, arena } = body as Record<string, unknown>;
  if (chainId !== ADDR.chainId || String(arena).toLowerCase() !== ADDR.arena.toLowerCase()) throw new Error('The app is updating. Reload before playing.');
  if (typeof session !== 'string' || !isAddress(session) || session.toLowerCase() === zeroAddress ||
      typeof label !== 'string' || !/^[a-zA-Z0-9:/._-]{1,160}$/.test(label)) throw new Error('Invalid match key metadata');
  const scope = [ADDR.chainId, ADDR.arena.toLowerCase(), owner, session.toLowerCase()] as const;
  const existing = db.prepare('SELECT label FROM passkey_match_keys WHERE chain_id = ? AND arena = ? AND owner = ? AND session = ?').get(...scope) as { label: string } | undefined;
  if (existing && existing.label !== label) throw new Error('Match key metadata already exists');
  db.prepare('INSERT OR IGNORE INTO passkey_match_keys (chain_id, arena, owner, session, label, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(...scope, label, Date.now());
  return { ok: true };
}

export function readMatchKey(owner: string, session: string) {
  if (!isAddress(owner) || !isAddress(session)) throw new Error('Invalid match key address');
  return (db.prepare('SELECT label FROM passkey_match_keys WHERE chain_id = ? AND arena = ? AND owner = ? AND session = ?')
    .get(ADDR.chainId, ADDR.arena.toLowerCase(), owner.toLowerCase(), session.toLowerCase()) as { label: string } | undefined) ?? null;
}
