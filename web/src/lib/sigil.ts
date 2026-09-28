import { keccak_256 } from '@noble/hashes/sha3';

/**
 * A player's sigil: a mirrored 5×5 pixel mark derived from their address (like a blockie), so every
 * wallet is recognisable at a glance without avatars. Two tones from the hash. Pure, so the server
 * share card draws the same mark the game does.
 */
export function sigil(addr: string) {
  const h = keccak_256(new TextEncoder().encode(addr.toLowerCase()));
  const hue = Math.round((h[20] / 255) * 360);
  const cells: [number, number, boolean][] = [];
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++) {
      const b = h[y * 3 + x];
      if (b % 3 === 0) continue; // ~1/3 empty keeps the mark airy
      const two = (b & 4) !== 0;
      cells.push([x, y, two]);
      if (x < 2) cells.push([4 - x, y, two]);
    }
  return { cells, fg: `hsl(${hue} 72% 64%)`, alt: `hsl(${(hue + 150) % 360} 55% 42%)` };
}
