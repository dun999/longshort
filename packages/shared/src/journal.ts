/** Public format only. Storage never receives a journal key or plaintext. */
export const JOURNAL_NAMESPACE = 'longshort.fun/private-match-journal/prf/v1';
// SHA-256(JOURNAL_NAMESPACE). Independent of Mera's existing account PRF salt.
export const JOURNAL_PRF_SALT = 'RN4hzI6EwDw-pJt6ZXaqBM2HLRjT8GStFbWJw31qJrI';
export const JOURNAL_MAX_BYTES = 8_000;
export interface JournalEnvelope {
  version: 1;
  namespace: typeof JOURNAL_NAMESPACE;
  prfSalt: typeof JOURNAL_PRF_SALT;
  nonce: string;
  ciphertext: string;
}
export interface JournalRecord { envelope: JournalEnvelope; revision: number; updatedAt: number }
export interface JournalContext { chainId: number; arena: string; owner: string; matchId: number }
export interface JournalNote { thesis: string; reflection: string }
export function journalBinding(context: JournalContext) {
  if (!Number.isSafeInteger(context.matchId) || context.matchId < 1 || !Number.isSafeInteger(context.chainId) || context.chainId < 1 ||
      !/^0x[0-9a-fA-F]{40}$/.test(context.owner) || !/^0x[0-9a-fA-F]{40}$/.test(context.arena)) throw new Error('Invalid journal context');
  return JSON.stringify([JOURNAL_NAMESPACE, 1, context.chainId, context.arena.toLowerCase(), context.owner.toLowerCase(), context.matchId]);
}
export function validJournalEnvelope(value: unknown): value is JournalEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  return Object.keys(e).sort().join(',') === 'ciphertext,namespace,nonce,prfSalt,version' && e.version === 1 &&
    e.namespace === JOURNAL_NAMESPACE && e.prfSalt === JOURNAL_PRF_SALT &&
    typeof e.nonce === 'string' && /^[A-Za-z0-9_-]{16}$/.test(e.nonce) &&
    typeof e.ciphertext === 'string' && /^[A-Za-z0-9_-]+$/.test(e.ciphertext) &&
    e.ciphertext.length >= 22 && e.ciphertext.length <= Math.ceil((JOURNAL_MAX_BYTES + 16) * 4 / 3);
}
