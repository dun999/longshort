import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@longshort/shared'],
  reactStrictMode: false, // r3f canvas + websockets double-mount noisily in dev
  devIndicators: { position: 'bottom-right' }, // keep the dev badge off the loadout panel
  // production: a self-contained server bundle; a separate dist dir keeps `next dev` untouched
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // the share card reads its fonts from disk at runtime
  outputFileTracingIncludes: { '/s/[code]/card': ['./src/assets/fonts/*.ttf'] },
};

export default nextConfig;
