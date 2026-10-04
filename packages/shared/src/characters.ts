// The arena cast. A character is cosmetic and separate from leverage: any character plays at any leverage.
// Models live in web/public/models/<id>.glb (built from web/art/cast).

export const CHARACTERS = ['gladiator', 'sniper', 'pathfinder', 'pirate', 'pigeon', 'keone'] as const;
export type CharacterId = (typeof CHARACTERS)[number];

export const CHARACTER_INFO: Record<CharacterId, { name: string; line: string }> = {
  gladiator: { name: 'Gladiator', line: 'Bronze, a crest and a shield the size of a door.' },
  sniper: { name: 'Sniper', line: 'Jungle marksman with a very long rifle.' },
  pathfinder: { name: 'Pathfinder', line: 'Desert runner, hood up, two daggers.' },
  pirate: { name: 'Pirate', line: 'Tricorn, cutlass and a chest of gold.' },
  pigeon: { name: 'Pigeon', line: 'Eats crumbs. Fears nothing.' },
  keone: { name: 'Keone', line: 'Plain black shirt, Monad cap.' },
};

export const isCharacter = (v: unknown): v is CharacterId => typeof v === 'string' && (CHARACTERS as readonly string[]).includes(v);

/** A player's character: their pick if they made one, otherwise a stable default from their address. */
export function characterOf(addr: string | undefined, chosen?: unknown): CharacterId {
  if (isCharacter(chosen)) return chosen;
  let h = 0;
  for (const ch of (addr ?? '').toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CHARACTERS[h % CHARACTERS.length];
}
