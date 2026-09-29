# longshort.fun

PvP perpetual matches on Monad. Players escrow a stake, trade virtual leveraged BTC, ETH, and MON positions against each other, and `ArenaCore` pays the winners from that pot. The pot is only the escrowed stakes. Every open, close, liquidation, elimination, and payout is its own transaction, priced by Perpl's onchain mark.

| Mode | Shape | Clock | Who gets paid |
|---|---|---|---|
| Duel | 1v1 | 60s | Higher final equity takes the prize. A tie refunds both stakes. |
| Squad | 3v3 | 120s | Higher team equity splits the prize equally. A tie refunds everyone. |
| Royale | 8 free-for-all | 180s | Lowest equity is eliminated each round. Top 3 take 60 / 30 / 10. |
| Practice | vs a bot | — | Offchain. Live prices, no escrow, no payout. |

Leverage is a class stored on the player: **Tank 10x**, **Scout 25x**, **Sniper 50x**. It can be changed until the bell. Entry sizes are 5, 20, or 50 of the stake token (6 decimals).

## Why Monad

A duel is a minute long and a trader clicks many times. The fill has to confirm while the match is still live. Monad produces a block about every 300ms and finalizes it in about 600ms, so each click is a final onchain trade. The HUD shows that round-trip as ping, from click to fill.

The price source is on the same chain. `PerplOracle` calls Perpl's `getPerpetualInfo` (BTC perp 16, ETH 32, MON 64) and uses whichever of mark and oracle is fresher, reverting if it is older than 60 seconds. Settlement does not trust a keeper signature.

EIP-7702 is how passkey accounts play with an empty MON balance. A relayer submits the transaction and pays the gas. `ArenaCore` still sees the player, or that match's trading key, as `msg.sender`. The Arena contract did not have to learn about sponsorship.

## How a match runs

1. **Queue.** The browser asks the keeper where to sit. The keeper holds that seat, so two people who press Play together land in the same lobby instead of each opening their own.
2. **Stake.** The owner key signs `approve` (if needed) and `createMatch` or `joinMatch`. The entry moves into `ArenaCore`. The join also registers this match's trading key.
3. **Countdown.** When the lobby fills, the contract starts a 15 second countdown, then the clock (`duration`). An unfilled lobby can be left for a refund, and anyone can cancel it after 5 minutes.
4. **Trade.** The trading key signs `open`, `close`, and `setClass`. Each player starts at $1,000 of virtual margin. Notional is equity × class leverage × size. One position at a time. Flipping side closes and reopens in the same call.
5. **Knockouts.** Equity at or below $100 (10% of starting margin) is liquidatable by anyone. In Royale the keeper also calls `eliminate` on the lowest equity each round, until three players remain. A duel or squad can settle early once one side is entirely out. Royale can settle early once one player remains.
6. **Payout.** At the bell, or as soon as the match is decided, anyone can call `settle`. The contract closes leftover positions at the oracle, ranks equity, and transfers the stake token. The keeper does this on a one-second loop. `liquidate`, `eliminate`, `settle`, and `cancel` are permissionless.

## Architecture

```
browser (Next.js, viem, Mera)
    │  signed calls, or a signed payload for /relay
    ▼
keeper (Node, SQLite, HTTP, WebSocket) ──► Monad
    │  settle / liquidate / eliminate / bots / faucet / relay
    ▼
Envio (HyperSync → GraphQL)   reads the same Arena events for public stats
```

| Piece | What it does |
|---|---|
| `contracts/` | Foundry. `ArenaCore` holds escrow, positions, and payouts. `PerplOracle` reads Perpl. `MockOracle` is the local stand-in. `TestUSD` is the local faucet token. `RelayDelegate` is the EIP-7702 sponsor. |
| `keeper/` | Matchmaking, parties, the settlement loop (simulate, then send), a labelled bot fleet, the stake faucet, and `/relay`. It also tails Arena logs into SQLite about every 0.7s for the live API, and polls Perpl once a second for the charts. |
| `indexer/` | Envio on Monad testnet (chain 10143). HyperSync is the primary source, the public RPC is the fallback. It indexes both the tUSD and AUSD arenas into GraphQL for `/stats` and rank history. |
| `web/` | Next.js 15. A persistent react-three-fiber stage, the HUD, and lightweight-charts. Game math is imported from `packages/shared`, which mirrors the contract, so the liquidation price on screen is the liquidation price onchain. |
| `packages/shared` | Generated ABIs, deployment addresses, and the constants the HUD and the keeper share. |

The keeper's SQLite database is the live game: lobbies, names, the trade feed, parties. Envio is the public history. Both are projections of Arena events. Neither is allowed to invent a fill.

## Accounts and gas

Three ways in:

- **Passkey (Mera).** One Face ID, Touch ID, or PIN prompt returns WebAuthn PRF bytes. HKDF derives an owner key (`longshort/owner/v1`) and a trade root, then a fresh secp256k1 key per match (`longshort/match/<label>`). The owner holds the stake and signs join, leave, and approve. The match key is registered as the session and may only trade inside that match. Key material stays in memory. The keyring locks after 30 minutes idle and on page unload. A live match pins it open so a prompt cannot land mid-round. localStorage keeps the credential id and match labels, never the keys.
- **Browser wallet.** The wallet confirms the stake. A per-browser session key signs the trades.
- **Guest.** One burner key in the browser is both owner and trader, funded with stake from the faucet.

Sign-in is separate from trading. One signature buys a 30-day token so the websocket can speak for that address: parties, invites, and the queue. An unlocked passkey or a guest signs it silently.

**Passkey gas.** On the tUSD deployment the owner and the match key delegate, once, to `RelayDelegate` (EIP-7702). Each action is an EIP-712 `Execute` the browser signs and posts to `/relay`. The keeper's relayer submits it and pays the MON. The first transaction carries the delegation. After that, players hold 0 MON. The delegate only forwards Arena calls (`createMatch`, `joinMatch`, `leave`, `open`, `close`, `setClass`) and an `approve` whose spender is the Arena. It checks the signature, bumps its own nonce, and calls through, so a revert comes back as the Arena error.

Monad bills the gas *limit* of a transaction, including a failed one, and a delegated account cannot be the one whose MON balance drops below 10. Players never spend MON, so an empty delegated account is valid. The relayer is an ordinary EOA that sends constantly, so it keeps its own funded key, separate from the settlement keeper (a shared key collides on nonce), and it stays above 10 MON. `/relay` simulates before sending, caps the gas, and rate-limits per address and per IP.

A browser wallet such as MetaMask will not delegate to an arbitrary contract, so those owner transactions still pay their own gas. The session key is a local key and is sponsored like a passkey match key.

Local Anvil and the AUSD deployment have no `relayDelegate` address. There the keeper still drips a little MON to the owner and tops match keys up from a gas station. Turning sponsorship on for a deployment is the delegate address in that deployment's address file, plus `RELAYER_KEY` on the keeper.

## Fees and payouts

Two different fees, and they do not come out of the same balance.

**Trading fee, 1 bp of notional, each side.** Charged in virtual dollars on open and again on close, subtracted from realized PnL. It changes equity and therefore who wins. It does not transfer stake tokens.

**Rake, 2.5% of the pot.** Taken in the stake token at settlement and sent to the treasury. The rest is the prize. Rounding dust goes to the treasury with the rake. A tie skips the rake and refunds every entry.

| Mode | Prize |
|---|---|
| Duel | The winner receives the whole prize. |
| Squad | Each player on the winning team receives an equal share. |
| Royale | 60% / 30% / 10% to 1st / 2nd / 3rd. Survivors rank by equity. Players already out rank by how late they went out. |

Equity is `$1,000 + realized PnL + unrealized PnL`, floored at 0. Unrealized PnL is the oracle move on notional, signed by side. Liquidation freezes a player at 0 equity and closes their position. It does not move the stake. The stake sits in the contract until `settle` or a refund.

Max loss is the entry. A player cannot owe more than they escrowed, because the virtual account is not a credit line and the contract only ever redistributes the pot.

Payouts go to the owner address that joined, not to the match key. Leaving an open lobby, or a cancel after the five-minute timeout, returns the entry in full.

## Run it

Local chain, mock oracle, faucet token:

```bash
npm install
(cd contracts && forge install foundry-rs/forge-std@v1.16.2 OpenZeppelin/openzeppelin-contracts@v5.7.0)
npm run dev:chain          # anvil, 1s blocks, chain id 31337
npm run contracts:build && npm run deploy:local
cp keeper/.env.example keeper/.env
npm run keeper             # API on :8787, bots, live Perpl prices mirrored into the mock oracle
npm run web                # http://localhost:3000
```

Monad testnet uses the deployments already recorded in `packages/shared/src/`. `npm run use:testnet` selects the tUSD arena (sponsored gas). `npm run use:testnet-ausd` selects the AUSD arena (self-paid gas). Point the keeper at `RPC_URL=https://testnet-rpc.monad.xyz` with `KEEPER_KEY` for settlement and, on tUSD, a different `RELAYER_KEY` funded above 10 MON. Point the web at that RPC and at the keeper (`NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_API_URL`).

`npm run deploy:testnet` deploys a *new* Arena and overwrites `addresses.json`. It is for a fresh environment, not for restarting the live one.
