# Access-code gate

Production is private by default. Every application page (including `/play`, practice, shared results and card images), keeper operation, live WebSocket and hosted GraphQL request requires a valid access-code session. Only `/gate`, `/gate/enter`, compiled framework files and the explicit icon/manifest paths are public. Wallet authentication remains a separate check for player operations.

The web and keeper use the server-only `@longshort/shared/gate` module. Sessions are signed, randomized, host-only `HttpOnly`/`Secure`/`SameSite=Lax` cookies with a server-checked 24-hour lifetime. Changing the access code or signing secret invalidates previous sessions. Legacy password-hash cookies are not accepted. Missing secrets return the gate/unavailable screen or a 503; they never enable public mode.

## Production setup

1. Run `scripts/private-mode.sh configure` to securely stage a new code and random signing secret in `/etc/longshort/web.env`. The script accepts an 8–256 character code made of letters, digits, dots, underscores and hyphens. It does not print the code or restart services. Both systemd units, `longshort-web` and `longshort-keeper`, must include `EnvironmentFile=/etc/longshort/web.env`; the file must be root-owned, mode 600. Set `NODE_ENV=production`, `HOSTNAME=127.0.0.1` (Next), `HOST=127.0.0.1` (keeper), and `GATE_ORIGIN=https://longshort.fun`. The configure script writes these values.
2. Install `deploy/longshort.caddy` at `/etc/caddy/longshort.caddy` and replace the existing **longshort.fun and www.longshort.fun blocks only** in `/etc/caddy/Caddyfile` with `import /etc/caddy/longshort.caddy`. Preserve other sites. Validate the configuration. Leave reloading to the deployment script, after the new keeper and web are running.
3. Bind Envio/Hasura to loopback, for example Docker's `127.0.0.1:8080:8080` port mapping. Next (3100), keeper (8787), GraphQL (8080), database and administrative ports must not be publicly published. Caddy is the public entry point. Do not expose a separate indexer URL that bypasses Caddy.
4. Remove any CDN rule that caches application HTML, Next navigation responses, API responses or shared cards, and purge old public cached responses if a CDN is configured. Caddy itself has no response cache in this configuration. Previously downloaded pages/cards cannot be remotely erased.
5. Run `scripts/deploy.sh all` between matches for the first gate-v2 release. Preflight requires both secrets, the exact Caddy configuration, both services' shared environment file and loopback GraphQL. Keeper health must confirm the gate version, enabled state and configuration. Activation checks unauthenticated deep links, RSC/prefetch requests, forged cookies/headers, APIs, GraphQL and WebSockets, then verifies a real code login across the services. Later web-only releases require the upgraded keeper already running.

The `off` command is intentionally refused. To rotate access, stage a new code with `configure` and deploy both services again. Sessions in open tabs lose access; keeper sockets expire or close on the next operation. The keeper's settlement/recovery processes continue independently of browser sessions. Deployment still refuses to restart during open or active rounds.

## Proxy and rate limits

Caddy overwrites `X-Gate-Client-IP` from its socket peer and strips `X-Middleware-Subrequest`. Set `GATE_TRUST_PROXY=1` only with this proxy and loopback-only web binding. Without a trusted proxy header, requests share one limited bucket instead of trusting arbitrary `X-Forwarded-For` values. The single web process allows 10 code submissions per client and 100 total per 15 minutes; failures return 429 with `Retry-After`. Bodies are limited to 4 KiB and code submissions must originate from `GATE_ORIGIN`.

Rate-limit counters live in the web process and reset on restart. Before scaling to multiple web processes, move these counters to shared storage. This deployment uses one process. A shared code can be shared with others; use per-person invitations if individual revocation becomes necessary.

Caddy checks `/gate/page` before application requests and `/gate` before GraphQL. The keeper independently guards HTTP requests and WebSocket upgrades/messages/output. It closes established sockets at expiry and rechecks them for rotation. GraphQL WebSocket subscriptions are disabled because the app uses HTTP GraphQL and the keeper feed, and Hasura cannot revalidate this cookie during a subscription. Browser API errors and session expiry return the visitor to the gate.

Detailed `/health` is available to direct loopback probes. Requests forwarded through the public proxy require the access session. Secret values and cookies must never be logged, embedded in a `NEXT_PUBLIC_*` variable, or passed as CLI arguments.

## Verification

```bash
npm -w keeper test
npm -w web test
npm -w keeper run typecheck
node_modules/.bin/tsc --noEmit -p web/tsconfig.json
NEXT_DIST_DIR=.next-prod npm -w web run build
```

`scripts/check-gate.mjs` checks a running deployment without trading or modifying game data. It performs read-only requests and one code login. Supply `GATE_PASSWORD` through the process environment; use `GATE_CHECK_ORIGIN` for another deployment and `GATE_CHECK_WEB_ONLY=1` when testing a standalone Next server. The release script reads the staged server code without printing it and runs this check automatically.

For local work, set `GATE_DEV_BYPASS=1` explicitly in both environments, or supply both secrets and `GATE_ORIGIN=http://localhost:3000` to test the gate. Production ignores the bypass variable. The unit suites explicitly enable it for unrelated gameplay fixtures; gate tests explicitly disable it or use production configuration.

This gate controls the website and hosted services. Public blockchain data and direct contract access remain public.
