/**
 * Media URLs carry their file's content hash: `?v=` + the first 12 hex of its SHA-256, computed by
 * next.config.ts at build time for public/models, public/cast, public/brand and public/audio. The middleware lets a
 * browser holding a valid access session keep a versioned file privately until it changes; every request
 * still passes the gate, and an unversioned or stale URL is never cached. scripts/check-gate.mjs checks
 * the same rule with the same hash.
 */
export const ASSET_CACHE = 'private, max-age=31536000, immutable';

let hashes: Record<string, string> | undefined;
const versions = () => (hashes ??= JSON.parse(process.env.NEXT_PUBLIC_ASSET_HASHES || '{}') as Record<string, string>);

/** `/models/sniper.glb` → `/models/sniper.glb?v=<hash>` (unchanged if the file is unknown). */
export function asset(path: string) {
  const v = versions()[path];
  return v ? `${path}?v=${v}` : path;
}

/** True when `v` is the current hash of the file at `path`. */
export const currentAsset = (path: string, v: string | null) => !!v && versions()[path] === v;
