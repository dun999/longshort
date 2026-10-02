# longshort.fun

**Sixty-second trading duels on Monad.** Two players commit AUSD entry stakes and separate trading budgets, execute real BTC positions on Perpl, and compete for the entry pot. At settlement, the higher final trading balance wins; both players receive their remaining trading collateral separately.

Built for [Monad Metropolis](https://hackathon.monad.xyz/).

| | |
| --- | --- |
| Live application | [longshort.fun](https://longshort.fun) |
| Network | Monad testnet, chain 10143 |
| Live mode | BTC Duel, 60 seconds, 5× leverage |
| Entry | 5, 20, or 50 AUSD per player |
| Trading capital | 100 AUSD per player, separate from the entry |
| Active arena | [`0xbD4F69440C3c5cb84769d74c595E33ca6044a414`](https://testnet.monadscan.com/address/0xbD4F69440C3c5cb84769d74c595E33ca6044a414) |
| AUSD | [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadscan.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) |

The deployed website uses testnet contracts and tokens. Production deployment of the website does not switch the application to Monad mainnet.

## Integration documentation

The `docs/` directory contains three guides explaining the integrations used by Longshort:

- [Agora AUSD](docs/AGORAUSD.md): wallet funding, entry escrow, real Perpl collateral, prizes, returned capital, and recorded transaction evidence.
- [Envio](docs/ENVIO.md): contract events, GraphQL entities, fills, results, rankings, statistics, and keeper fallback.
- [Mera](docs/MERA.md): passkey sign-in, owner/match-key derivation, signing sessions, key lifetime, and sponsored execution.

## Try it

1. Open [longshort.fun](https://longshort.fun). If the private-preview gate is enabled, enter the preview access code.
2. Sign in with a passkey through Mera. Browser-wallet and guest options are also available.
3. Use **Claim AUSD** to request the testnet funding transfer. The current claim amount is 200 AUSD per eligible wallet.
4. Choose **Duel** and an entry. The lobby shows the separate 100 AUSD trading budget and the total required balance before joining.
5. After the 15-second countdown, trade BTC with **Long**, **Short**, and **Close**. Perpl executes the orders onchain using the player's isolated trading account.
6. At the bell, positions are flattened, the entry prize is distributed, and remaining collateral returns to each owner. The result screen links to the match report and sharing options.

**Practice** needs no account or AUSD. It uses live BTC, ETH, and MON prices with simulated positions in the browser. It waits for usable prices and pauses when the feed becomes unavailable.

## Prize and trading capital

Each live player supplies an entry plus a 100 AUSD Perpl budget. These amounts have separate purposes: entry stakes form the prize pot; the trading budgets collateralize real positions and can decrease through losses, fees, and funding.

A 5 AUSD duel requires 105 AUSD per player. Its 10 AUSD entry pot pays a 9.75 AUSD prize after the 2.5% rake. Equal final balances refund both entries without a rake. Returned trading collateral belongs to each player and is independent of the prize.

The arena enters `CLOSING` at settlement and retries incomplete exchange closes. It reaches `SETTLED` after both accounts are flat. Collateral return and recovery always target the account's owner beneficiary.

The legacy `ArenaCore` implementation remains available for local virtual-margin Duel, Squad, and Royale regression tests. The current live AUSD deployment exposes Duel and Practice.

## Architecture

```text
browser (Next.js, viem, Mera)
  │ owner signatures + per-match trading signatures
  ▼
keeper (HTTP, WebSocket, SQLite, relay)
  │ sponsored submissions and settlement retries
  ▼
Monad testnet
  ├─ PerplArena: entry escrow, round authorization, scoring, prizes
  ├─ MatchTradingAccount: one player's isolated AUSD Perpl account
  ├─ Perpl: actual BTC orders and collateral accounting
  └─ AUSD: funding, escrow, payout, and collateral-return transfers
       │ contract events
       ▼
Envio HyperIndex → GraphQL → profiles, ranks, stats, match reports
```

| Path | Responsibility |
| --- | --- |
| `contracts/` | `PerplArena`, `MatchTradingAccount`, EIP-7702 `RelayDelegate`, and legacy/local contracts and tests |
| `keeper/` | Authenticated matchmaking, parties/invites, price delivery, bots, durable AUSD claims, relay, settlement, and SQLite event projections |
| `indexer/` | Envio event handlers and schema for the active arena, Perpl fills, and AUSD collateral returns |
| `web/` | Next.js UI, persistent 3D scene, responsive trading controls, chart, accounts, results, and English/Indonesian copy |
| `packages/shared/` | Active deployment addresses, ABIs, chains, relay types, and shared game constants |
| `_legacy/` | Original prototype |

Mera derives the owner and each match key from passkey PRF output. Passkey-derived keys stay in memory; the owner holds AUSD, while the registered match key signs round actions. The keyring locks after inactivity or page unload and stays pinned during a round.

For passkey accounts, the configured EIP-7702 delegate and keeper relayer sponsor gas. The delegate restricts destinations and methods, verifies signed payloads, and advances its nonce. Browser-wallet owner transactions can use the wallet's own gas flow.

Envio indexes onchain history independently of the keeper's live API. Historical pages prefer GraphQL when configured and can fall back to keeper reads. Contracts determine execution and payouts; neither the keeper database nor the indexer can invent an onchain fill.

## Verify it

```bash
npm -w keeper test
npm -w keeper run typecheck
npm run contracts:test
node_modules/.bin/tsc --noEmit -p web/tsconfig.json
NEXT_DIST_DIR=.next-prod npm -w web run build
```

The contract suite includes local regression tests and optional RPC-backed fork tests. The real-exchange fork checks are enabled explicitly with `PERPL_FORK_RPC`; see [PerplFork.t.sol](contracts/test/PerplFork.t.sol). Keeper tests use fixtures rather than deployed signing keys.

## Run locally

Use Node 22+, npm, and Foundry. For the local virtual-margin profile:

```bash
npm install
npm run use:local
npm run dev:chain
# In a second terminal:
npm run contracts:build
npm run deploy:local
cp keeper/.env.example keeper/.env
npm run keeper
# In a third terminal:
npm run web
```

The web app runs at `http://localhost:3000`; the keeper API runs at `http://localhost:8787`.

The active AUSD/Perpl deployment is recorded in [addresses.json](packages/shared/src/addresses.json) and [addresses.testnet-perpl.json](packages/shared/src/addresses.testnet-perpl.json). Testnet configuration needs the matching RPC, keeper funding/relay settings, and browser API URL. Environment files and signing keys are excluded from Git. Selecting a different profile changes the app's contract bindings; use the matching keeper configuration.

Website releases use [scripts/deploy.sh](scripts/deploy.sh). `scripts/deploy.sh web` builds the production standalone web bundle and restarts the web service on the configured VPS. Contract deployment commands create new onchain deployments; they are separate from a website release.
