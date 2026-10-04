#!/usr/bin/env bash
# Build first, snapshot SQLite, activate keeper, then activate web on longshort.fun.
# Previous code and a consistent database snapshot stay in /opt/longshort/releases.
# Credentials remain in the ignored .env.deploy and server environment files.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[[ -f $ROOT/.env.deploy ]] && source "$ROOT/.env.deploy"
HOST=${DEPLOY_HOST:?set DEPLOY_HOST=user@host}
KEY=${DEPLOY_KEY:?set DEPLOY_KEY=/path/to/ssh/key}
SSH=(ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$KEY")
printf -v SSH_RSYNC 'ssh -o BatchMode=yes -o IdentitiesOnly=yes -i %q' "$KEY"
what=${1:-all}
[[ $what == all || $what == web || $what == keeper ]] || { echo 'usage: deploy.sh [all|web|keeper]' >&2; exit 1; }

# Production is always a pushed commit: the build reads the working tree, so refuse anything GitHub doesn't have.
git -C "$ROOT" diff --quiet HEAD -- || { echo 'Tracked files have uncommitted changes. Commit and push first.' >&2; exit 1; }
stray=$(git -C "$ROOT" ls-files --others --exclude-standard -- web keeper/src packages scripts deploy)
[[ -z $stray ]] || { printf 'Untracked files would ship:\n%s\nCommit or remove them first.\n' "$stray" >&2; exit 1; }
git -C "$ROOT" fetch -q origin main
git -C "$ROOT" merge-base --is-ancestor HEAD origin/main || { echo 'HEAD is not on origin/main. Push first.' >&2; exit 1; }
release="$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$ROOT" rev-parse --short HEAD)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
proxy_sha=$(sha256sum "$ROOT/deploy/longshort.caddy" | cut -d ' ' -f 1)

echo '▸ checking access-gate configuration before building'
"${SSH[@]}" "$HOST" "NODE_OPTIONS=--no-warnings node --input-type=module - preflight '$release' '$what' '$proxy_sha'" < "$ROOT/scripts/release-server.mjs"

if [[ $what == all || $what == web ]]; then
  echo '▸ building web'
  (cd "$ROOT/web" && NEXT_DIST_DIR=.next-prod \
    NEXT_PUBLIC_API_URL=https://longshort.fun/api \
    NEXT_PUBLIC_RPC_URL=https://testnet-rpc.monad.xyz \
    NEXT_PUBLIC_SESSION_TOPUP=0.15 \
    NEXT_PUBLIC_ENVIO_GRAPHQL_URL=https://longshort.fun/v1/graphql npx next build)
  out="$ROOT/web/.next-prod/standalone"
  rm -rf "$out/web/.next-prod/static"
  cp -r "$ROOT/web/.next-prod/static" "$out/web/.next-prod/static"
  [[ -d $ROOT/web/public ]] && cp -r "$ROOT/web/public" "$out/web/public"
fi
if [[ $what == all || $what == keeper ]]; then
  echo '▸ bundling keeper'
  (cd "$ROOT" && npx esbuild keeper/src/main.ts --bundle --platform=node --format=esm --target=node22 \
    --outfile="$tmp/keeper.mjs" --external:bufferutil --external:utf-8-validate --log-level=warning \
    --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);")
fi
node --input-type=module - "$ROOT" "$tmp" "$what" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [root, tmp, what] = process.argv.slice(2);
const deployment = JSON.parse(readFileSync(`${root}/packages/shared/src/addresses.json`, 'utf8'));
writeFileSync(`${tmp}/manifest.json`, JSON.stringify({ chainId: deployment.chainId, arena: deployment.arena,
  keeperSha256: what !== 'web' ? createHash('sha256').update(readFileSync(`${tmp}/keeper.mjs`)).digest('hex') : undefined,
  webBuildId: what !== 'keeper' ? readFileSync(`${root}/web/.next-prod/BUILD_ID`, 'utf8').trim() : undefined,
}, null, 2));
NODE

echo '▸ checking idle rounds and backing up keeper database'
"${SSH[@]}" "$HOST" "NODE_OPTIONS=--no-warnings node --input-type=module - prepare '$release' '$what'" < "$ROOT/scripts/release-server.mjs"
rsync -az -e "$SSH_RSYNC" "$tmp/manifest.json" "$HOST:/opt/longshort/releases/$release/manifest.json"
rsync -az -e "$SSH_RSYNC" "$ROOT/scripts/check-gate.mjs" "$HOST:/opt/longshort/releases/$release/check-gate.mjs"
if [[ $what == all || $what == keeper ]]; then
  rsync -az -e "$SSH_RSYNC" "$tmp/keeper.mjs" "$HOST:/opt/longshort/releases/$release/keeper.mjs"
  "${SSH[@]}" "$HOST" "NODE_OPTIONS=--no-warnings node --input-type=module - keeper '$release' '$what'" < "$ROOT/scripts/release-server.mjs"
fi
if [[ $what == all || $what == web ]]; then
  rsync -az --delete -e "$SSH_RSYNC" "$out/" "$HOST:/opt/longshort/releases/$release/web/"
  "${SSH[@]}" "$HOST" "NODE_OPTIONS=--no-warnings node --input-type=module - web '$release' '$what'" < "$ROOT/scripts/release-server.mjs"
fi
echo "▸ release $release deployed"
# Detailed health is loopback-only; public access is exercised by check-gate.mjs during activation.
