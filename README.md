# longshort.fun

**Sixty-second trading duels on Monad.** Two to eight players escrow a stake, trade leveraged BTC, ETH and MON against each other on live Perpl prices, and the Arena contract pays the winners from the pot. Every click is its own onchain trade, final before the next second of the match ticks by.

Built for [Monad Metropolis](https://hackathon.monad.xyz/), 1 September to 13 October 2026.

| | |
|---|---|
| Live | [longshort.fun](https://longshort.fun) (private preview) |
| Network | Monad testnet, chain 10143 |
| Arena, test USD, sponsored gas | [`0x0eD849346BDE6C70071F20780150A75678651871`](https://testnet.monadscan.com/address/0x0eD849346BDE6C70071F20780150A75678651871) |
| Arena, AUSD | [`0x4f64530B8805543b133A5A2FA706A0239A82c7a1`](https://testnet.monadscan.com/address/0x4f64530B8805543b133A5A2FA706A0239A82c7a1) |
| RelayDelegate (EIP-7702) | [`0xd908f5dE46F2A20cA7bCa397be704145072CB5B8`](https://testnet.monadscan.com/address/0xd908f5dE46F2A20cA7bCa397be704145072CB5B8) |
| PerplOracle | [`0xc6C58E0B3360F293Caf646A78EB189B03C8d851d`](https://testnet.monadscan.com/address/0xc6C58E0B3360F293Caf646A78EB189B03C8d851d) |

## Try it

1. Open [longshort.fun](https://longshort.fun) and press **Play**.
2. Sign in with a passkey: Face ID, Touch ID or a PIN. There is no seed phrase, no extension and no gas token to buy. The new account gets test stake, and its transactions are sponsored.
3. Pick a mode and an entry. The queue seats you with other players. Labelled bots can fill empty seats, and Settings turns that off.
4. Choose a class (your leverage) during the 15-second countdown, then trade: **Long**, **Short**, **Close**. The HUD shows each fill's round trip as ping.
5. At the bell the contract settles and pays out. The result screen links the settlement transaction and makes a share card.

No account needed for **Practice**: the same math, on live prices, against a sparring bot in the browser, with no stake.

## The game

| Mode | Shape | Clock | Who gets paid |
|---|---|---|---|
| Duel | 1v1 | 60s | Higher final equity takes the prize. A tie refunds both stakes. |
| Squad | 3v3 | 120s | Higher team equity splits the prize equally. A tie refunds everyone. |
| Royale | 8 free-for-all | 180s | Lowest equity is eliminated each round. Top 3 take 60 / 30 / 10. |
| Practice | vs a bot | none | Offchain. Live prices, no escrow, no payout. |

Everyone starts with **$1,000 of virtual margin** and one position at a time on BTC, ETH or MON. Leverage is a class: **Tank 10x**, **Scout 25x**, **Sniper 50x**, changeable until the bell. Entries are 5, 20 or 50 of the stake token.

- **Knockouts.** Equity at or below $100 (10% of starting margin) is liquidatable by anyone. In Royale the lowest equity is eliminated each round until three remain. A match settles early once it is decided.
- **Trading fee.** 1 bp of notional on open and again on close, in virtual dollars. It changes equity, and so who wins. It never moves stake tokens.
- **Rake.** 2.5% of the pot, taken in the stake token at settlement. A tie skips the rake and refunds every entry.
- **Max loss is the entry.** The virtual account is not a credit line, and the contract only ever redistributes the pot. Payouts go to the address that joined.

## Why Monad

A duel lasts a minute and a trader clicks many times, so each fill has to confirm while the match is still live. Monad makes a block about every 300 ms and finalizes it in about 600 ms, so every click is a final onchain trade rather than an offchain order settled later.

The price is on the same chain. `PerplOracle` calls Perpl's `getPerpetualInfo` (BTC perp 16, ETH 32, MON 64), takes whichever of mark and oracle price is fresher, and reverts if it is older than 60 seconds. Settlement never trusts a keeper's price.

EIP-7702 lets a passkey account play with 0 MON. A relayer submits the transaction and pays the gas, while `ArenaCore` still sees the player (or that match's trading key) as `msg.sender`. The Arena contract did not have to learn about sponsorship.

## What is onchain

| Onchain, in `ArenaCore` | Offchain, in the keeper |
|---|---|
| Escrow of every entry | Queue and matchmaking, parties, invites |
| Every open, close and class change | Display names, labelled bots |
| Liquidations, eliminations, settlement, payouts | Price history for the charts |
| Prices, read from Perpl by the contract | Submitting sponsored transactions |

`liquidate`, `eliminate`, `settle` and `cancel` are permissionless. The keeper calls them on a one-second loop, but anyone can. The keeper cannot move a stake, set a price or invent a fill: its database and the Envio index are both projections of Arena events.

## How a match runs

1. **Queue.** The browser asks the keeper where to sit. The keeper holds that seat, so two people who press Play together land in the same lobby.
2. **Stake.** The owner key signs `approve` (once) and `createMatch` or `joinMatch`. The entry moves into `ArenaCore`, and the join registers this match's trading key.
3. **Countdown.** When the lobby fills, the contract starts a 15-second countdown, then the clock. An unfilled lobby can be left for a full refund, and anyone can cancel it after 5 minutes.
4. **Trade.** The trading key signs `open`, `close` and `setClass` with no prompts. Notional is equity × leverage × size. Flipping side closes and reopens in one call.
5. **Payout.** At the bell, or once the match is decided, `settle` closes leftover positions at the oracle price, ranks equity and transfers the stake token.

## Architecture

```
browser (Next.js, viem, Mera)
    │  signed calls, or signed payloads for /relay
    ▼
keeper (Node, SQLite, HTTP, WebSocket) ──► Monad testnet ◄── Perpl (prices)
    │  settle, liquidate, eliminate, bots, faucet, relay
    ▼
Envio HyperIndex (HyperSync → GraphQL)   the same Arena events, as public history
```

| Path | What it holds |
|---|---|
| `contracts/` | Foundry. `ArenaCore` (escrow, positions, payouts), `PerplOracle`, `RelayDelegate` (EIP-7702), plus `MockOracle` and `TestUSD` for local runs. |
| `keeper/` | Matchmaking and parties, the settlement loop (simulate, then send), the bot fleet, the stake faucet and `/relay`. It tails Arena logs into SQLite every ~0.7 s for the live API and polls Perpl once a second for the charts. |
| `indexer/` | Envio on Monad testnet. HyperSync first, RPC as fallback. Indexes both arenas into `Match`, `MatchPlayer`, `Trade` and `Trader` for stats, profiles, match reports and rank history. |
| `web/` | Next.js 15. A persistent react-three-fiber arena, a phone-first HUD, lightweight-charts, English and Indonesian. Game math is imported from `packages/shared`, which mirrors the contract, so the liquidation price on screen is the one onchain. |
| `packages/shared` | Generated ABIs, deployment addresses and the constants the HUD and keeper share. |
| `_legacy/` | The first prototype (9 September). The practice bot and the Perpl reader were ported from it. |

## Accounts and gas

- **Passkey ([Mera](https://mera.category.xyz) by Category Labs).** One Face ID, Touch ID or PIN prompt returns WebAuthn PRF bytes. HKDF derives an owner key (`longshort/owner/v1`) and a trade root, then a fresh key for every match (`longshort/match/<label>`). The owner holds the stake. The match key may only trade inside its match. Keys live in memory, never in storage; the keyring locks after 30 idle minutes and on page unload, and a live match holds it open so no prompt lands mid-round.
- **Browser wallet.** The wallet confirms the stake. A per-browser session key signs the trades.
- **Guest.** One burner key in the browser is both owner and trader.

**Sponsored gas.** On the test-USD arena, the owner and each match key delegate once to `RelayDelegate`. Every action is an EIP-712 `Execute` the browser signs and posts to `/relay`, and a relayer key pays the MON. The first transaction carries the delegation. The delegate only forwards Arena calls (`createMatch`, `joinMatch`, `leave`, `open`, `close`, `setClass`) and an `approve` whose spender is the Arena, checks the signature, and bumps its own nonce.

Two Monad rules shape the relay. Monad bills the gas *limit*, including for a transaction that reverts, so `/relay` simulates first, caps gas and rate-limits per address and per IP. A delegated account cannot lower its own MON balance below 10, which is fine because players never spend MON. The relayer uses its own key, separate from the settlement keeper, because a shared key collides on nonce.

MetaMask and similar wallets refuse to delegate to an arbitrary contract, so a browser wallet still pays for its own stake transactions; its session key is sponsored. The AUSD arena and local Anvil have no delegate, so there the keeper drips a little MON instead.

## Built with

- **[Perpl](https://perpl.xyz).** The contract reads its onchain perps as the settlement price, and the keeper streams the same feed to the charts.
- **[Envio](https://envio.dev).** HyperIndex on HyperSync turns all eleven Arena events into GraphQL for public history.
- **[Agora](https://www.agora.finance) AUSD.** The second arena stakes AUSD.
- **[Mera](https://mera.category.xyz).** Passkey accounts with no smart-account contract and no custody service.
- **EIP-7702 on Monad.** Sponsored gas through `RelayDelegate`.

## Verify it

```bash
cd contracts && forge test
```

55 tests: `ArenaCore` unit tests, a multiplayer QA suite, the relay delegate, and two fork tests that run against Monad testnet (the live Perpl oracle, and gas use).

Every trade in a match links to its transaction on MonadScan, and the match report lists the full onchain history of a finished match.

## Run it locally

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

Monad testnet uses the deployments recorded in `packages/shared/src/`. `npm run use:testnet` selects the test-USD arena (sponsored gas) and `npm run use:testnet-ausd` the AUSD arena. Point the keeper at `RPC_URL=https://testnet-rpc.monad.xyz` with `KEEPER_KEY` for settlement and, on test USD, a separate `RELAYER_KEY` funded above 10 MON. Point the web at that RPC and at the keeper with `NEXT_PUBLIC_RPC_URL` and `NEXT_PUBLIC_API_URL`.

`npm run deploy:testnet` deploys a *new* Arena and overwrites `addresses.json`. It is for a fresh environment, not for restarting the live one.
