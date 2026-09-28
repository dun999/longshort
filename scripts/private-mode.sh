#!/usr/bin/env bash
# Private preview switch for longshort.fun. One variable, GATE_PASSWORD in /etc/longshort/web.env,
# gates the pages (web middleware), the keeper API + WebSocket and the Envio GraphQL (Caddy
# forward_auth → keeper /gate). The keeper reads the same file through a systemd drop-in.
# Nothing in the code changes either way.
#   scripts/private-mode.sh status   is the site private?
#   scripts/private-mode.sh off      go public: remove the access code, restart web + keeper
#   scripts/private-mode.sh on       set a new access code (prompted, never echoed), restart
# Restarting the keeper interrupts a running match: switch between matches.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[[ -f $ROOT/.env.deploy ]] && source "$ROOT/.env.deploy"
HOST=${DEPLOY_HOST:?set DEPLOY_HOST=user@host (or put it in .env.deploy)}
KEY=${DEPLOY_KEY:?set DEPLOY_KEY=/path/to/ssh/key (or put it in .env.deploy)}
SSH="ssh -o BatchMode=yes -o IdentitiesOnly=yes -i $KEY $HOST"
RESTART='sudo systemctl restart longshort-web longshort-keeper && sleep 3 && systemctl is-active longshort-web longshort-keeper'

case ${1:-status} in
  status)
    $SSH 'sudo grep -q "^GATE_PASSWORD=." /etc/longshort/web.env && echo "private: access code required" || echo "public: no access code"'
    ;;
  off)
    read -rp "Make longshort.fun public for everyone? [y/N] " yes
    [[ $yes == y || $yes == Y ]] || exit 1
    $SSH "sudo sed -i '/^GATE_PASSWORD=/d' /etc/longshort/web.env && $RESTART"
    echo "▸ public"
    ;;
  on)
    read -rsp "New access code: " pw
    echo
    [[ -n $pw && $pw != *$'\n'* ]] || { echo "empty code" >&2; exit 1; }
    # the code travels on stdin, never on a command line
    printf 'GATE_PASSWORD=%s\n' "$pw" | $SSH "sudo sh -c 't=\$(mktemp); grep -v ^GATE_PASSWORD= /etc/longshort/web.env > \$t; cat >> \$t; install -m 600 -o root -g root \$t /etc/longshort/web.env; rm -f \$t' && $RESTART"
    echo "▸ private: teammates sign in again with the new code"
    ;;
  *)
    echo "usage: $0 status|on|off" >&2
    exit 1
    ;;
esac
