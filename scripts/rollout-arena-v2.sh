#!/usr/bin/env bash
# One-time server changes for PerplArena v2 (Duel, Squad 2v2, Royale at 5/10/15x), after `scripts/deploy.sh all`:
#   1. enough bots to fill a Royale (7 seats) and a Squad alongside it
#   2. Envio re-indexes from the new arena's deploy block (the old match ids would otherwise shadow the new ones)
# The keeper archives the old arena's match tables itself on its first start; claims, callsigns, passkey hints
# and journals carry over. Restarting the keeper interrupts a live round: run this between matches.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[[ -f $ROOT/.env.deploy ]] && source "$ROOT/.env.deploy"
HOST=${DEPLOY_HOST:?set DEPLOY_HOST=user@host}
KEY=${DEPLOY_KEY:?set DEPLOY_KEY=/path/to/ssh/key}
SSH=(ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$KEY" "$HOST")

echo '▸ keeper: 10 bots'
"${SSH[@]}" "sed -i 's/^BOT_COUNT=.*/BOT_COUNT=10/' /opt/longshort/keeper/.env.testnet && grep '^BOT_COUNT=' /opt/longshort/keeper/.env.testnet"

echo '▸ indexer: new arena address and start block'
"${SSH[@]}" "cp /opt/longshort/indexer/config.yaml /opt/longshort/indexer/config.yaml.bak-\$(date -u +%Y%m%dT%H%M%SZ)"
scp -o BatchMode=yes -o IdentitiesOnly=yes -i "$KEY" "$ROOT/indexer/config.yaml" "$HOST:/opt/longshort/indexer/config.yaml"
# the unit pins ENVIO_PG_SCHEMA (drop-in ausd.conf); resetting any other schema leaves the service crash-looping
# on "config changes are incompatible with the existing indexer data"
"${SSH[@]}" "cd /opt/longshort/indexer && PG=\$(systemctl show longshort-indexer -p Environment --value | tr ' ' '\n' | grep '^ENVIO_PG_SCHEMA=' || true) && echo \"schema: \${PG:-public}\" && sudo systemctl stop longshort-indexer && env \$PG npx envio codegen >/dev/null && env \$PG npx envio local db-migrate setup && sudo systemctl start longshort-indexer"

echo '▸ restart keeper with the new bot count'
"${SSH[@]}" "sudo systemctl restart longshort-keeper"
curl -fsS --retry 20 --retry-all-errors --retry-delay 3 https://longshort.fun/api/health; echo

echo '▸ wait for Envio to index the new arena'
for _ in $(seq 30); do
  meta=$(curl -fsS -X POST https://longshort.fun/v1/graphql -H 'content-type: application/json' \
    -d '{"query":"{ chain_metadata { start_block latest_processed_block block_height } }"}' || true)
  if [[ $meta == *'"start_block":67943161'* && $meta != *'"latest_processed_block":-1'* ]]; then echo "$meta"; exit 0; fi
  sleep 4
done
echo "indexer did not start: $meta" >&2
"${SSH[@]}" "systemctl is-active longshort-indexer; journalctl -u longshort-indexer --no-pager -n 15 --output=cat | cut -c1-200" >&2
exit 1
