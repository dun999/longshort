#!/usr/bin/env bash
# Stage shared access-gate settings. A subsequent guarded deployment activates them.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[[ -f $ROOT/.env.deploy ]] && source "$ROOT/.env.deploy"
HOST=${DEPLOY_HOST:?set DEPLOY_HOST=user@host}
KEY=${DEPLOY_KEY:?set DEPLOY_KEY=/path/to/ssh/key}
SSH=(ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$KEY" "$HOST")

case ${1:-status} in
  status)
    "${SSH[@]}" 'sudo sh -c '\''if grep -q "^GATE_PASSWORD=." /etc/longshort/web.env && grep -Eq "^GATE_SESSION_SECRET=.{32,}$" /etc/longshort/web.env; then echo "Gate secrets configured (activation is verified during deployment)."; else echo "Gate configuration incomplete; deployment will be refused."; fi'\'''
    ;;
  configure|on)
    read -rsp "New access code (8–256 letters, digits, dots, underscores or hyphens): " pw
    echo
    [[ ${#pw} -ge 8 && ${#pw} -le 256 && $pw =~ ^[A-Za-z0-9_.-]+$ ]] || { echo 'Invalid access code format.' >&2; exit 1; }
    # Password travels only on stdin. A new signing secret also revokes existing sessions.
    printf 'GATE_PASSWORD=%s\n' "$pw" | "${SSH[@]}" 'sudo sh -c '\''set -eu; t=$(mktemp); trap "rm -f $t" EXIT; chmod 600 "$t"; sed -E "/^(GATE_PASSWORD|GATE_SESSION_SECRET|GATE_DEV_BYPASS|GATE_TRUST_PROXY|GATE_ORIGIN|NODE_ENV|HOST|HOSTNAME)=/d" /etc/longshort/web.env > "$t"; printf "\n" >> "$t"; cat >> "$t"; secret=$(openssl rand -hex 32); printf "GATE_SESSION_SECRET=%s\n" "$secret" >> "$t"; printf "%s\n" "GATE_DEV_BYPASS=0" "GATE_TRUST_PROXY=1" "GATE_ORIGIN=https://longshort.fun" "NODE_ENV=production" "HOST=127.0.0.1" "HOSTNAME=127.0.0.1" >> "$t"; install -m 600 -o root -g root "$t" /etc/longshort/web.env'\'''
    unset pw
    echo 'Gate settings staged. Install deploy/longshort.caddy as documented, then run scripts/deploy.sh all between matches.'
    ;;
  off)
    echo 'Production access cannot be disabled. GATE_DEV_BYPASS=1 is available only in local development.' >&2
    exit 1
    ;;
  *) echo "usage: $0 status|configure" >&2; exit 1 ;;
esac
