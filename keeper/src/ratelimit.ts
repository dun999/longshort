/*
 * Sliding-window caps per caller (an IP, an address, a socket). Idle keys are swept, so a stream of fresh
 * wallets or addresses cannot grow the table forever.
 */
export interface Rule { n: number; ms: number }

const hits = new Map<string, { ms: number; at: number[] }>();

/** Counts this call against `key` and says whether it is within `rule`. */
export function allow(key: string, rule: Rule, now = Date.now()) {
  const entry = hits.get(key) ?? { ms: rule.ms, at: [] };
  entry.at = entry.at.filter((t) => t > now - rule.ms);
  entry.ms = Math.max(entry.ms, rule.ms);
  hits.set(key, entry);
  if (entry.at.length >= rule.n) return false;
  entry.at.push(now);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, { ms, at }] of hits) if (!at.length || at[at.length - 1] <= now - ms) hits.delete(key);
}, 60_000).unref();

/** The client address Caddy saw. Caddy replaces any X-Forwarded-For a client sends, so the first entry is the peer. */
export const clientIp = (req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }) =>
  String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress).split(',')[0].trim();
