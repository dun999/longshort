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
"${SSH[@]}" "cd /opt/longshort/indexer && sudo systemctl stop longshort-indexer && npx envio codegen >/dev/null && npx envio local db-migrate setup && sudo systemctl start longshort-indexer"

echo '▸ restart keeper with the new bot count'
"${SSH[@]}" "sudo systemctl restart longshort-keeper && sleep 5 && systemctl is-active longshort-keeper longshort-indexer"
curl -fsS https://longshort.fun/api/health; echo
