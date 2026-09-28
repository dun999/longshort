# longshort.fun: PvP perpetuals arena on Monad

**Queue up, pick a class, and outtrade real rivals. Every click is an onchain transaction. The contract pays the winner.**

longshort is a new market structure: **PnL-settled trading competitions**. Players escrow a stake. Then they trade leveraged BTC/ETH/MON positions priced by Perpl's onchain mark price, where every open, close, liquidation and elimination is a Monad tx. At the bell, `ArenaCore` closes every position and pays the best performers from the pot. There's no house and no counterparty risk: the pot is only the players' stakes.

| Mode | Format | Winner |
|---|---|---|
| **Duel** | 1v1 · 60s | Higher final equity takes the pot (or the survivor, if the rival is liquidated) |
| **Squad** | 3v3 · 120s · party with friends | Team with the higher summed equity splits the pot |
| **Royale** | 8 FFA · 180s | Lowest equity is cut every round, and the top 3 are paid 60/30/10 |
| **Practice** | vs bot · live prices | Nothing onchain |

Classes are real contract parameters: **Tank 10x · Scout 25x · Sniper 50x**. You pick one on a Valorant-style agent-select screen after the match is found.

## Why this needs Monad

A 60-second match where each trader clicks 10–30 times is **hundreds of settlement events per match**. On a 12s chain, a click lands after the match has moved. On an L2 with a centralized sequencer, you've rebuilt a CEX. With 400ms blocks and 800ms finality, **each click is a real onchain fill that confirms in under a second**, so the HUD shows the measured latency of every trade. Liquidations are permissionless calls, and royale eliminations are too. The result can be verified from events alone.

## Architecture

```
contracts/        Foundry: ArenaCore (escrow, positions, liquidation, royale cuts, settlement),
                  oracles/ (PerplOracle reads Perpl onchain, MockOracle for local), TestUSD faucet token
keeper/           Node service: settles/eliminates/liquidates (simulate-then-send), bot fleet, gas station,
                  SQLite event indexer, HTTP API (matchmaking, sign-in, faucet), WebSocket (party, presence, live feed)
indexer/          Envio (HyperSync): contract events → GraphQL for public stats
web/              Next.js 15: persistent react-three-fiber stage (camera "shots" per phase),
                  motion HUD, lightweight-charts, procedural WebAudio SFX
packages/shared/  ABIs (generated), addresses, game math shared by HUD + keeper
```

**A match, end to end:** Play → the keeper picks a lobby and holds the seat (players who press Play together meet) → the browser stakes with `createMatch`/`joinMatch` → every trade is a tx signed by that match's trading key → at the bell the keeper calls `settle` → `ArenaCore` pays the winners. `liquidate`, `eliminate` and `settle` are permissionless; the keeper just calls them on time.

**Where the data comes from**
- **Prices:** Perpl's perpetuals exchange on Monad, via `getPerpetualInfo` (the oracle price when it is newer than the mark price). `ArenaCore` reads it onchain through `PerplOracle`; the keeper polls the same call every second for the charts.
- **Match history:** contract events only. The keeper indexes them into SQLite every 0.7s; Envio indexes them for the public GraphQL feed.

**Accounts**
- **Passkey (recommended, via Mera):** one Face ID / Touch ID / PIN prompt yields WebAuthn PRF entropy. HKDF derives an owner key (holds the stake) and one key per match, registered as that match's session key: it trades without prompts and can never move funds. Nothing is stored; keys are wiped on lock, after 30 minutes idle, and when the page is hidden.
- **Browser wallet:** you confirm the stake once; a per-browser session key signs every trade.
- **Guest:** a burner key in the browser, funded by the keeper faucet, for one-click play.
- **Sign-in:** one signature buys a 30-day token, so the live connection can speak for your address (parties, invites, matchmaking). Guests and unlocked passkeys sign silently.
- **Gas:** the keeper's gas station tops up every human trading key, so nobody needs MON to trade.

**Economics**
- **Stake:** the entry, in tUSD on testnet, escrowed by the contract. Pot = entry × players, minus a 2.5% rake to the treasury.
- **Payouts:** the Duel winner takes the prize, the winning Squad splits it, and Royale pays 60/30/10.
- **Trading:** everyone starts with $1,000 of virtual margin. Leverage comes from the class (10/25/50x), each fill pays a 0.01% fee, and a position is liquidated at 10% of starting margin.
- **Max loss is the entry.**

**Trust UI:** fills show the oracle price, fee, and liquidation price with the contract's exact formula. Bots are always labelled. `/information` is the full risk disclosure (`/rules` redirects), and `/stats` shows public metrics derived from events.

## Run locally

```bash
npm install
(cd contracts && forge install foundry-rs/forge-std@v1.16.2 OpenZeppelin/openzeppelin-contracts@v5.7.0)
npm run dev:chain                 # anvil, 1s blocks
npm run contracts:build && npm run deploy:local
cp keeper/.env.example keeper/.env   # defaults work for anvil
npm run keeper                    # keeper + bots + API on :8787 (mirrors live Perpl prices)
npm run web                       # http://localhost:3000
```

## Deploy to Monad testnet

```bash
DEPLOYER_KEY=0x… MONAD_RPC_URL=https://testnet-rpc.monad.xyz npm run deploy:testnet   # writes packages/shared/src/addresses.json
# keeper/.env: RPC_URL=https://testnet-rpc.monad.xyz, KEEPER_KEY=<deployer>, BOT_MNEMONIC=<fresh>, FAUCET_MON=0.15
# web/.env.local: NEXT_PUBLIC_RPC_URL=https://testnet-rpc.monad.xyz, NEXT_PUBLIC_API_URL=<keeper url>
```

## Who it's for (first users)

1. **Perp DEX growth teams, starting with Perpl.** Duels are an acquisition funnel: a new user learns leverage, liquidation and PnL with a fixed downside (the stake) before ever touching a real order book. This is the most direct first partner.
2. **Trading-competition communities and CT groups** already run PnL contests on spreadsheets and screenshots, with trust issues around fake PnL. longshort gives them verifiable, self-settling brackets.
3. **Prop-firm-style challenge takers**: skill evaluation with a capped entry and an onchain track record, where the match history is the résumé.

**Why this doesn't already exist:** PvP trading games so far are either offchain (trust the operator's PnL) or settle only the final result. Per-click onchain fills require sub-second, cheap blocks. Monad is where that becomes true.

## Traction & next steps

- Bots are optional in Settings (off by default). Rematch invites preserve the prior roster, teams, and stake. Nicknames are searchable in the lobby and Ranks.
- Bots and testers generate real onchain matches continuously. `/stats` shows settled matches, trades, txs and human-vs-bot volume, all from contract events.
- **Next:**
  1. Testnet public launch with weekly Royale tournaments (target 1,000 matches and 250 human wallets in the first 4 weeks).
  2. Perpl partnership for a "real-position" mode, where the arena routes hedged orders into Perpl.
  3. Mainnet with AUSD stakes, after an audit.
