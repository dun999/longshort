#!/usr/bin/env bash
# Redeploy longshort.fun (web + keeper) to the VPS.
#   scripts/deploy.sh            build + ship web and keeper, restart both
#   scripts/deploy.sh web        web only
#   scripts/deploy.sh keeper     keeper only
# Server layout: /opt/longshort/{web,keeper,indexer}, systemd units longshort-{web,keeper,indexer},
# Caddy in /etc/caddy/Caddyfile. Secrets stay on the server (/etc/longshort/web.env, keeper/.env.testnet).
# The target comes from DEPLOY_HOST (user@host) and DEPLOY_KEY (ssh key path), or from a git-ignored .env.deploy.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[[ -f $ROOT/.env.deploy ]] && source "$ROOT/.env.deploy"
HOST=${DEPLOY_HOST:?set DEPLOY_HOST=user@host (or put it in .env.deploy)}
KEY=${DEPLOY_KEY:?set DEPLOY_KEY=/path/to/ssh/key (or put it in .env.deploy)}
SSH="ssh -o BatchMode=yes -o IdentitiesOnly=yes -i $KEY"
what=${1:-all}

if [[ $what == all || $what == web ]]; then
  echo "▸ building web"
  (cd "$ROOT/web" && NEXT_DIST_DIR=.next-prod \
    NEXT_PUBLIC_API_URL=https://longshort.fun/api \
    NEXT_PUBLIC_RPC_URL=https://testnet-rpc.monad.xyz \
    NEXT_PUBLIC_SESSION_TOPUP=0.15 \
    NEXT_PUBLIC_ENVIO_GRAPHQL_URL=https://longshort.fun/v1/graphql \
    npx next build)
  out="$ROOT/web/.next-prod/standalone"
  rm -rf "$out/web/.next-prod/static" && cp -r "$ROOT/web/.next-prod/static" "$out/web/.next-prod/static"
  [[ -d $ROOT/web/public ]] && cp -r "$ROOT/web/public" "$out/web/public"
  echo "▸ shipping web"
  rsync -az --delete -e "$SSH" "$out/" "$HOST:/opt/longshort/web/"
  $SSH "$HOST" 'sudo systemctl restart longshort-web && sleep 2 && systemctl is-active longshort-web'
fi

if [[ $what == all || $what == keeper ]]; then
  echo "▸ bundling keeper"
  tmp=$(mktemp -d)
  (cd "$ROOT" && npx esbuild keeper/src/main.ts --bundle --platform=node --format=esm --target=node22 \
    --outfile="$tmp/keeper.mjs" --external:bufferutil --external:utf-8-validate --log-level=warning \
    --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);")
  echo "▸ shipping keeper (never run a local keeper at the same time: same key)"
  rsync -az -e "$SSH" "$tmp/keeper.mjs" "$HOST:/opt/longshort/keeper/dist/keeper.mjs"
  $SSH "$HOST" 'sudo systemctl restart longshort-keeper && sleep 3 && systemctl is-active longshort-keeper'
  rm -rf "$tmp"
fi

curl -s -o /dev/null -w "▸ https://longshort.fun → %{http_code}\n" https://longshort.fun/gate
