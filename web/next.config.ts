import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

/** `/models/sniper.glb` → first 12 hex of its SHA-256, for the 3D cast and its 2D renders (see src/lib/asset.ts). */
function assetHashes() {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) walk(file);
      else out['/' + path.relative('public', file).split(path.sep).join('/')] = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);
    }
  };
  for (const d of ['models', 'cast', 'brand']) walk(path.join('public', d));
  return out;
}

const nextConfig: NextConfig = {
  transpilePackages: ['@longshort/shared'],
  reactStrictMode: false, // r3f canvas + websockets double-mount noisily in dev
  devIndicators: { position: 'bottom-right' }, // keep the dev badge off the loadout panel
  // production: a self-contained server bundle; a separate dist dir keeps `next dev` untouched
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  distDir: process.env.NEXT_DIST_DIR || '.next',
  env: { NEXT_PUBLIC_ASSET_HASHES: JSON.stringify(assetHashes()) },
  // the share card reads its fonts and the class figures from disk at runtime
  outputFileTracingIncludes: { '/s/[code]/card': ['./src/assets/fonts/*.ttf', './src/assets/cast/*.png'] },
  webpack: (config) => {
    // the arena uses Bloom and Vignette only; see src/components/three/n8ao-stub.ts
    config.resolve.alias = { ...config.resolve.alias, n8ao$: path.resolve(process.cwd(), 'src/components/three/n8ao-stub.ts') };
    return config;
  },
};

export default nextConfig;
