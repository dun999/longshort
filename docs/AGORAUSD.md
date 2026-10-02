# How Longshort uses Agora AUSD

Longshort uses Agora's AUSD as the wallet balance, duel entry stake, Perpl trading collateral, and prize asset. The live application runs on **Monad testnet (chain 10143)**. Its real-trading flow executes BTC orders on Perpl using testnet tokens; Practice runs in the browser without moving AUSD.

## Deployment

The selected deployment is recorded in [addresses.json](../packages/shared/src/addresses.json). Agora lists the same testnet token in its [official contract deployments](https://docs.agora.finance/developer/contract-deployments).

| Component | Current configuration |
| --- | --- |
| AUSD token | [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadscan.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) |
| Token precision | 6 decimals; `1 AUSD = 1,000,000` token units |
| PerplArena | [`0xbD4F69440C3c5cb84769d74c595E33ca6044a414`](https://testnet.monadscan.com/address/0xbD4F69440C3c5cb84769d74c595E33ca6044a414) |
| Perpl exchange | [`0x1964C32f0bE608E7D29302AFF5E61268E72080cc`](https://testnet.monadscan.com/address/0x1964C32f0bE608E7D29302AFF5E61268E72080cc) |
| Supported live round | Two-player BTC Duel, 60 seconds, 5× leverage |
| Entry choices | 5, 20, or 50 AUSD per player |
| Trading budget | 100 AUSD per player, separate from the entry |

## The AUSD flow

1. **Sign in and fund.** A [Mera passkey account](MERA.md) owns the AUSD. The wallet reads `balanceOf` and displays the balance in the header and account menu. The explicit Claim AUSD flow requests a 200 AUSD testnet transfer from Longshort's provisioned funding wallet. This is an ERC-20 transfer, not a mint or an Agora API integration.
2. **Approve and join.** The owner approves the arena and calls `createMatch` or `joinMatch`. The browser checks that the wallet can cover both the entry and the 100 AUSD trading budget. A 5 AUSD duel therefore requires 105 AUSD per player.
3. **Separate prize and collateral.** `PerplArena` holds the entry in prize escrow and creates a dedicated `MatchTradingAccount` clone for the player's trading budget. That account deposits its 100 AUSD into Perpl; its beneficiary is the player's owner address.
4. **Execute real trades.** The registered match key requests Long, Short, or Close through the arena. Perpl fills change the account's actual collateral balance. Protocol fees, funding, and trading losses affect this budget; entry escrow does not collateralize the position.
5. **Close and score.** At the bell, the arena enters `CLOSING` and attempts to flatten both accounts. Partial or deferred closes can be retried. A round reaches `SETTLED` only when both accounts are flat and have no locked balance or remaining positions.
6. **Pay and return capital.** The higher final Perpl balance wins the entry pot after a 2.5% rake. Equal balances refund both entries without a rake. Each player's remaining collateral is separately returned to their owner address, regardless of who won. A recovery path can retry collateral withdrawal after settlement or cancellation.

For two 5 AUSD entries, the pot is 10 AUSD, the rake is 0.25 AUSD, and the winner's prize is 9.75 AUSD. That prize is separate from returned trading collateral. Trading losses can reduce the 100 AUSD budget, so the entry alone is not the player's total exposure.

## Funding reliability and deployment checks

The claim service stores the signed transfer and its hash in SQLite **before** broadcasting. Concurrent retries and process restarts reuse that transfer rather than paying twice. A reverted receipt does not mark the wallet as funded. Claims are scoped to the testnet/token pair and require authenticated requests.

Keeper startup checks chain ID, deployed contract code, the arena/token/exchange bindings, token decimals, and relay bindings. Browser claim and join actions also compare the keeper's active deployment with the bundled deployment before proceeding.

The application uses standard ERC-20 reads, approvals, and transfers. It does not implement Agora minting, redemption, or instant-settlement APIs.

## Recorded testnet evidence

The repository's previously recorded duel #2 demonstrates the AUSD path through real Perpl fills:

| Action | Transaction |
| --- | --- |
| 200 AUSD funding transfer | [Claim receipt](https://testnet.monadscan.com/tx/0xe9da9763a08f9104ab25d08e52c04a1dd41af458e1e96b64de71d00e31fb2fab) |
| Create duel and fund its trading account | [Create receipt](https://testnet.monadscan.com/tx/0xfa0c48698029b5dd9a2f5fb5bf224990fc2db6a76a27aa57be8cf02557f1a056) |
| BTC long filled on Perpl | [Long receipt](https://testnet.monadscan.com/tx/0xde7f2859b7f7d1b642a4fca340df08f68b8c2c1e81a6d010cfb3e0e656dd2136) |
| Flatten remaining position and distribute the prize | [Settlement receipt](https://testnet.monadscan.com/tx/0x20275890486d1599d01a77482e38ac101f58c56187b9b60565c101065d6901b4) |

The recorded winning wallet reconciled as `200 − 5 − 100 + 99.743277 returned collateral + 9.75 prize = 204.493277 AUSD`. These are historical testnet results, not a projected return.

## Implementation

| Source | Responsibility |
| --- | --- |
| [PerplArena.sol](../contracts/src/PerplArena.sol) | Entry escrow, per-player accounts, closing, ranking, prizes, and refunds |
| [MatchTradingAccount.sol](../contracts/src/MatchTradingAccount.sol) | Perpl deposits, bounded BTC execution, collateral return, and recovery |
| [claims.ts](../keeper/src/claims.ts), [faucet.ts](../keeper/src/faucet.ts) | Durable testnet funding transfers |
| [preflight.ts](../keeper/src/preflight.ts) | Active deployment validation |
| [wallet.ts](../web/src/lib/wallet.ts), [actions.ts](../web/src/lib/actions.ts) | Balance/allowance reads, claim status, budget checks, and transaction submission |
| [ClaimAUSDDialog.tsx](../web/src/components/ClaimAUSDDialog.tsx) | Visible claim, pending, confirmation, and retry states |
| [ENVIO.md](ENVIO.md) | Indexed fills, final balances, payouts, and collateral-return history |

Tests: [claims.test.ts](../keeper/test/claims.test.ts) covers funding retries and failures; [PerplArena.t.sol](../contracts/test/PerplArena.t.sol) covers isolated accounts and settlement; [PerplFork.t.sol](../contracts/test/PerplFork.t.sol) provides optional exchange-fork checks.
