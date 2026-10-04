import { isIP } from 'node:net';

const WINDOW = 15 * 60_000;
/** Single web process today. Both buckets apply; untrusted/missing proxy headers share a bucket. */
export class GateAttempts {
  private clients = new Map<string, { count: number; until: number }>();
  private global = { count: 0, until: 0 };

  take(client: string, now = Date.now()): number {
    if (this.global.until <= now) this.global = { count: 0, until: now + WINDOW };
    for (const [key, bucket] of this.clients) if (bucket.until <= now) this.clients.delete(key);
    let bucket = this.clients.get(client);
    if (!bucket) {
      if (this.clients.size >= 10_000) return Math.ceil(WINDOW / 1000);
      bucket = { count: 0, until: now + WINDOW };
      this.clients.set(client, bucket);
    }
    if (bucket.count >= 10 || this.global.count >= 100) {
      return Math.max(1, Math.ceil(((bucket.count >= 10 ? bucket.until : this.global.until) - now) / 1000));
    }
    bucket.count++;
    this.global.count++;
    return 0;
  }
}

export function gateClient(headers: Headers) {
  const ip = headers.get('x-gate-client-ip') ?? '';
  return process.env.GATE_TRUST_PROXY === '1' && isIP(ip) ? ip : 'untrusted';
}

const state = globalThis as typeof globalThis & { gateAttempts?: GateAttempts };
export const gateAttempts = state.gateAttempts ??= new GateAttempts();
