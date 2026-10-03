# longshort.fun

**PvP BTC trading battles on Monad.** Players commit AUSD entry stakes and separate trading budgets, execute real BTC positions on Perpl, and compete for the entry pot: 1v1 Duels, 2v2 Squads and 8-player Royales. At settlement the bigger final trading balance wins (a team's summed balance in Squad; Royale pays the top three); every player receives their remaining trading collateral separately.

Built for [Monad Metropolis](https://hackathon.monad.xyz/).

| | |
| --- | --- |
| Live application | [longshort.fun](https://longshort.fun) |
| Network | Monad testnet, chain 10143 |
| Live modes | Duel 1v1 · 60 s, Squad 2v2 · 120 s, Royale 8 players · 180 s (lowest equity cut every 30 s), all BTC |
| Leverage | Tank 5×, Scout 10×, Sniper 15× (Perpl's BTC limit is 15×); a Squad team plays at its leader's pick |
| Entry | 5, 20, or 50 AUSD per player |
| Trading capital | 100 AUSD per player, separate from the entry |
| Active arena | [`0x5Efae3185739539E28FedcA99118C6D4EC9B2C1A`](https://testnet.monadscan.com/address/0x5Efae3185739539E28FedcA99118C6D4EC9B2C1A) (v2; the Duel-only v1 was `0xbD4F69440C3c5cb84769d74c595E33ca6044a414`) |
| AUSD | [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadscan.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) |

The deployed website uses testnet contracts and tokens. Production deployment of the website does not switch the application to Monad mainnet.

## Integration documentation

The `docs/` directory explains the integrations:

- [Agora AUSD](docs/AGORAUSD.md): wallet funding, entry escrow, real Perpl collateral, prizes, returned capital, and recorded transaction evidence.
- [Envio](docs/ENVIO.md): contract events, GraphQL entities, fills, results, rankings, statistics, and keeper fallback.
- [Mera](docs/MERA.md): the live passkey account layer, stateless recovery, scoped signing sessions, and the separate encrypted journal namespace.

## Try it

1. Open [longshort.fun](https://longshort.fun); the live demo is public.
2. Create or sign in with a passkey through Mera. No passkey on the device (for example a judge's test machine)? Use **Try as a guest** under the passkey options: a wallet kept in that browser whose key can be exported from the account menu. Browser-wallet accounts keep a separate recovery page.
3. Use **Claim AUSD** to request the testnet funding transfer (200 AUSD per eligible wallet), or **Deposit AUSD** from the account menu to send your own testnet AUSD to the account address.
4. Choose **Duel**, **Squad** or **Royale**, an entry and a class (5×, 10× or 15×). The lobby shows the separate 100 AUSD trading budget and total required balance. If alone, turn on **Match with bots** in **Settings** before joining; bot opponents are labelled.
5. After the 15-second countdown, trade BTC with **Long**, **Short**, and **Close**. Perpl executes the orders onchain using the player's isolated trading account.
6. At the bell, positions are flattened, the entry prize is distributed, and remaining collateral returns to each owner. The report shows actual ledger/receipts and an optional private journal. Open the journal with an explicit passkey verification; only ciphertext is saved.

The account menu's **Demo evidence** page records actual navigation-to-confirmation time, control activations, ceremonies, and public receipts. Measurements are not an achieved performance claim until the browser test is run.

**Practice** needs no account or AUSD. It uses live BTC prices with simulated positions in the browser, at the same leverage classes. It waits for usable prices and pauses when the feed becomes unavailable.

## Prize and trading capital

Each live player supplies an entry plus a 100 AUSD Perpl budget. These amounts have separate purposes: entry stakes form the prize pot; the trading budgets collateralize real positions and can decrease through losses, fees, and funding.

A 5 AUSD entry requires 105 AUSD per player. The pot is every entry added together, minus a 2.5% rake:

| Mode | Winner | 5 AUSD entry pays |
| --- | --- | --- |
| Duel | bigger final balance | 9.75 AUSD |
| Squad | bigger summed team balance, split equally | 9.75 AUSD to each winner |
| Royale | survivors by final balance, then later cuts rank higher; top three paid 60/30/10 | 23.40 / 11.70 / 3.90 AUSD |

Equal final balances (or team totals) refund every entry without a rake. Returned trading collateral belongs to each player and is independent of the prize. The full disclosure is on the site's Rules & Risks page.

The arena enters `CLOSING` at settlement and retries incomplete exchange closes. It reaches `SETTLED` after every account is flat. Collateral return and recovery always target the account's owner beneficiary.

The legacy `ArenaCore` implementation remains available for local virtual-margin regression tests. The live AUSD deployment exposes Duel, Squad, Royale and Practice. A live 15× Duel against a keeper bot, with real Perpl fills and a reconciled ledger, is recorded by `keeper/scripts/arena-v2-smoke.ts`.

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

Mera derives the owner and each match key from passkey PRF output. Passkey-derived keys stay in memory; the owner holds AUSD, while the registered match key signs round actions. Public derivation hints are saved durably before entry and verified against the onchain session during recovery, so browser storage is an optional cache. The keyring locks after inactivity or page unload and stays pinned during a round. Verification permits one entry attempt within two minutes; later entries ask again, and token approval is bounded to entry plus trading budget.

For passkey accounts, the configured EIP-7702 delegate and keeper relayer sponsor gas. The delegate restricts destinations and methods, verifies signed payloads, and advances its nonce. Existing browser-wallet accounts can still recover through their wallet's own gas flow.

The private journal evaluates a separate, versioned PRF salt through Mera, then derives a non-extractable AES-256-GCM key. Each save uses a fresh nonce and authenticates its deployment, owner, match and namespace. Plaintext/keys remain in memory; durable ciphertext uses revision checks to prevent silent concurrent overwrites.

Envio indexes onchain history independently of the keeper's live API. Historical pages prefer GraphQL when configured and can fall back to keeper reads. Contracts determine execution and payouts; neither the keeper database nor the indexer can invent an onchain fill.

## Verify it

```bash
npm -w keeper test
npm -w web test
npm -w keeper run typecheck
npm run contracts:test
node_modules/.bin/tsc --noEmit -p web/tsconfig.json
NEXT_DIST_DIR=.next-prod npm -w web run build
```

The contract suite includes local regression tests. Keeper tests use fixtures rather than deployed signing keys.

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

The keeper accepts `RPC_BACKUP_URL` for ordered provider failover across reads, bot/settlement/relay transactions and AUSD funding. `PERPL_RPC_BACKUP_URL` overrides the price client's backup; on Monad testnet it defaults to `RPC_BACKUP_URL`. A primary timeout, HTTP error or rate limit advances to the backup without background ranking probes; contract reverts still surface to the caller. Envio keeps HyperSync primary and accepts `ENVIO_RPC_BACKUP_URL` as a second RPC fallback after `ENVIO_RPC_URL`. Keep provider URLs with credentials in ignored environment files, outside the public web bundle.

Website releases use [scripts/deploy.sh](scripts/deploy.sh). It builds artifacts before activation, refuses to restart the keeper with active rounds, saves a consistent SQLite backup and previous code, and activates/health-checks the keeper before the web. `scripts/deploy.sh web` releases only the web bundle. Contract deployment commands create new onchain deployments; they are separate from a website release.
