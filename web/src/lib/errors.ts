import { STAKE } from '@longshort/shared';
import { tr, type Key } from './i18n';

/**
 * Player-facing wording for wallet, RPC and ArenaCore errors, in the player's language. The raw
 * error still goes to the console for debugging; the UI never shows a revert string or an RPC dump.
 */
const RULES: [RegExp, Key | null][] = [
  [/^Rematch|^Enable bot matching|^Lobby options|^Invalid lobby|^Invalid rematch/, null],
  [/user rejected|user denied|rejected the request|request rejected/i, 'err.cancelled'],
  [/passkey/i, null], // our own passkey messages are already written for players
  [/insufficient funds|insufficient balance for (?:gas|transaction)|balance too low|gas required exceeds allowance/i, 'err.gas'],
  [/exceeds balance|ERC20InsufficientBalance/i, 'err.stake'],
  [/allowance|ERC20InsufficientAllowance/i, 'err.allowance'],
  [/\bFull\b|TeamFull/, 'err.full'],
  [/NotOpen/, 'err.notOpen'],
  [/AlreadyJoined/, 'err.already'],
  [/NotLive/, 'err.notLive'],
  [/PlayerOut/, 'err.out'],
  [/NoPosition/, 'err.noPos'],
  [/BadPrice/, 'err.price'],
  [/TooEarly/, 'err.early'],
  [/No trading key registered/i, 'err.device'],
  [/relay dry|relay not configured|relay off/i, 'err.relay'],
  [/relay busy|nonce/i, 'err.busy'],
  [/timeout|timed out|fetch failed|failed to fetch|network error|HTTP request failed/i, 'err.net'],
  [/Connect a wallet/i, 'err.signIn'],
  [/Duel parties/, 'err.duelParty'],
  [/TooLate/, 'err.tooLate'],
];

export function friendly(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  console.warn('[longshort]', raw);
  for (const [re, key] of RULES) if (re.test(raw)) return key ? tr(key, { stake: STAKE }) : raw.split('\n')[0];
  return tr('err.generic');
}
