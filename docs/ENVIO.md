# How Longshort uses Envio

Longshort uses [Envio HyperIndex](https://docs.envio.dev/docs/HyperIndex/overview) to turn Monad testnet contract events into a GraphQL history of matches, players, Perpl fills, AUSD prizes, and returned trading collateral. That history powers profiles, rankings, arena statistics, and match reports.

The keeper handles live matchmaking, social state, price delivery, and transaction submission. Envio provides a separate projection of onchain events for historical reads; it does not authorize trades or determine payouts.

## Indexed contracts and events

[config.yaml](../indexer/config.yaml) selects chain **10143**, starts at block **67,943,161** (the v2 arena's deployment), and configures three contracts:

| Contract | Events used by Longshort |
| --- | --- |
| `PerplArena` at `0x5Efae3185739539E28FedcA99118C6D4EC9B2C1A` | Match creation/join/leave/start, leverage changes, opens/closes, liquidations, settlement/cancellation, trading-account creation, closing, final balances, and collateral returns |
| Perpl at `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` | `OrderRequestV2` and `TakerOrderFilledV2` |
| AUSD at `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` | `Transfer` |

The indexer's configured contract label is `ArenaCore`; in the current deployment it points to the real-trading `PerplArena` address. The label preserves the compatible game event interface.

HyperSync is the primary event source when a self-hosted `ENVIO_API_TOKEN` is configured. The configured Monad RPC is its fallback. [Envio's token requirements](https://docs.envio.dev/docs/HyperIndex/overview#hypersync-api-token-requirements) describe the self-hosted setup.

## How event data becomes the UI

[ArenaCore.ts](../indexer/src/handlers/ArenaCore.ts) applies the events to the entities defined in [schema.graphql](../indexer/schema.graphql).

| Entity | What it represents |
| --- | --- |
| `Match`, `MatchPlayer` | Round lifecycle, participants, registered session keys, results, prize payouts, and final equity |
| `Trade` | The arena's open/close/liquidation event history with transaction links |
| `TradingAccount` | A player's isolated Perpl account, initial budget, final balance, and returned AUSD |
| `PerplOrder`, `PerplFill` | The association between an exchange order and its actual taker fills, including price, size, and fees |
| `VaultAddress` | Mapping from a trading-account contract address to its Perpl account |
| `Trader` | Matches, wins/losses, XP, entry-prize earnings, fees, and executed volume |
| `ArenaStats`, `DailyStat` | Arena totals and daily activity |

Order requests are associated with known trading accounts; subsequent fills are attached to the correct match and trader. Executed volume comes from actual Perpl fills. `FinalBalance` supplies settlement equity. AUSD transfers from a known trading account to its owner record returned collateral, including direct recovery transactions outside the arena's normal settlement call.

Match IDs use `<arena>-<matchId>` and trader IDs use `<arena>-<wallet>`. Queries filter by the active arena, keeping the current AUSD deployment separate from previous deployments. Amount conversion is explicit: AUSD uses six decimals, normalized arena trade/equity values use eighteen, and raw Perpl fill prices use one.

Settlement updates wins, losses, and XP: a win adds 50 XP; a loss subtracts up to 20 with a floor of 1000; a draw adds zero. `Trader.earned` is **entry-prize payout minus entry**, not the player's total trading PnL or returned collateral.

## Browser queries and fallback

[envio.tsx](../web/src/lib/envio.tsx) implements `envioMatch`, `envioProfile`, `envioLeaderboard`, `envioStats`, and `envioSync`. It queries the GraphQL endpoint configured by `NEXT_PUBLIC_ENVIO_GRAPHQL_URL`; the production build uses `https://longshort.fun/v1/graphql`.

The `useIndexed` helper tries Envio first. If it is disabled, unavailable, or has no requested record, the page can use its keeper endpoint instead. The UI identifies the data source and exposes indexer synchronization status. Keeper profile metadata supplies offchain display names and bot labels alongside indexed wallet records.

For example, this query reads a round's asset, state, settlement transaction, and trading-account balances:

```graphql
query MatchHistory($id: String!) {
  Match_by_pk(id: $id) {
    matchId
    asset
    state
    settleTx
    accounts { address budget finalBalance returned }
  }
}
```

For match #2 in the active arena, `$id` is `0x5efae3185739539e28fedca99118c6d4ec9b2c1a-2`.

## Run the indexer

The indexer pins `envio` **3.12.1** in [package.json](../indexer/package.json). Use its own dependency lockfile and the database/Hasura settings in [.env.example](../indexer/.env.example):

```bash
cd indexer
npm ci
cp .env.example .env
# Configure the database and ENVIO_API_TOKEN in .env.
npx envio codegen
npx envio dev
```

The development stack needs Docker. Set the browser's `NEXT_PUBLIC_ENVIO_GRAPHQL_URL` to the resulting GraphQL endpoint before starting or building the web app. Tokens and database credentials stay in environment files, outside Git.

Related integrations: [Agora AUSD](AGORAUSD.md) supplies the amounts being tracked; [Mera](MERA.md) supplies the owner and match-key addresses associated with each player.
