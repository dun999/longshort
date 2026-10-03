import { ADDR, validJournalEnvelope, type JournalRecord } from '@longshort/shared';
import { signedIn } from './auth';
import { arena, pub } from './chain';
import { db } from './db';

export class JournalError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}
function scope(body: any) {
  const owner = signedIn(body);
  if (String(body.owner).toLowerCase() !== owner) throw new JournalError('Journal account changed. Sign in again.', 403, 'OWNER_CHANGED');
  if (body.chainId !== ADDR.chainId || String(body.arena).toLowerCase() !== ADDR.arena.toLowerCase())
    throw new JournalError('The app is updating. Reload before opening your journal.', 400, 'DEPLOYMENT_CHANGED');
  if (!Number.isSafeInteger(body.matchId) || body.matchId < 1) throw new JournalError('Invalid match', 400, 'INVALID_JOURNAL');
  return [ADDR.chainId, ADDR.arena.toLowerCase(), owner, body.matchId] as const;
}
export function readJournal(body: unknown): JournalRecord | null {
  const row = db.prepare('SELECT envelope, revision, updated_at FROM private_journals WHERE chain_id=? AND arena=? AND owner=? AND match_id=?')
    .get(...scope(body)) as { envelope: string; revision: number; updated_at: number } | undefined;
  return row ? { envelope: JSON.parse(row.envelope), revision: row.revision, updatedAt: row.updated_at } : null;
}
export async function saveJournal(body: any): Promise<JournalRecord> {
  const binding = scope(body);
  // Reject extra fields instead of accidentally persisting a caller's plaintext.
  const allowed = ['addr', 'token', 'owner', 'chainId', 'arena', 'matchId', 'expectedRevision', 'envelope'];
  if (Object.keys(body).some((key) => !allowed.includes(key)) || !validJournalEnvelope(body.envelope) ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)
    throw new JournalError('Invalid encrypted journal', 400, 'INVALID_JOURNAL');
  const players = await pub.readContract({ ...arena, functionName: 'getPlayers', args: [BigInt(body.matchId)] });
  if (!players.some((player) => player.addr.toLowerCase() === binding[2]))
    throw new JournalError('Only a player in this match can save its journal.', 403, 'NOT_A_PLAYER');
  const revision = body.expectedRevision + 1;
  const updatedAt = Date.now();
  const envelope = JSON.stringify(body.envelope);
  // SQLite compare-and-swap also protects against concurrent processes and tabs.
  const result = body.expectedRevision === 0
    ? db.prepare('INSERT OR IGNORE INTO private_journals VALUES(?,?,?,?,?,?,?)').run(...binding, envelope, revision, updatedAt)
    : db.prepare('UPDATE private_journals SET envelope=?, revision=?, updated_at=? WHERE chain_id=? AND arena=? AND owner=? AND match_id=? AND revision=?')
      .run(envelope, revision, updatedAt, ...binding, body.expectedRevision);
  if (result.changes !== 1) throw new JournalError('A newer journal was saved on another device. Review it before saving.', 409, 'JOURNAL_CONFLICT');
  return { envelope: body.envelope, revision, updatedAt };
}
