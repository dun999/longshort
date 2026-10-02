# How Longshort uses Mera

Longshort uses [Mera by Category Labs](https://github.com/category-labs/mera) to create an Ethereum-compatible account from a passkey. Players sign in with their device's passkey prompt, while the application derives separate owner and match-trading keys. A live round can then accept repeated trades without a passkey prompt for every click.

The integration uses `@category-labs/mera`, its viem adapter, and HKDF-SHA256. It is implemented in [mera.ts](../web/src/lib/mera.ts), with account state in [wallet.ts](../web/src/lib/wallet.ts).

## Sign-in and key derivation

1. **Create or unlock a passkey.** `createPasskeyWithPrfOutput` creates a credential; `getPasskeyPrfOutput` retrieves its PRF output during sign-in. The relying-party ID is the current hostname, and the relying-party name is `longshort.fun`.
2. **Derive purpose-separated keys.** HKDF uses the salt `longshort.fun/passkey-accounts` and distinct labels for the owner, trade root, and individual matches.
3. **Create signing sessions.** `createSecp256k1SigningSession` holds each derived key. `toViemAccount` exposes the session as a viem `LocalAccount`, which the existing transaction and authentication code can use.
4. **Discard temporary bytes.** The PRF output and temporary derived-key buffers are cleared after the signing sessions and trade root are created.

```text
Passkey PRF output
  ├─ HKDF("longshort/owner/v1")       → owner signing session
  └─ HKDF("longshort/trade-root/v1")  → in-memory trade root
       └─ HKDF("longshort/match/<label>") → match signing session
```

| Key | Role in Longshort |
| --- | --- |
| Owner | Holds AUSD, approves the arena, joins matches, and signs authenticated account requests |
| Trade root | Derives individual match keys; it is not itself a transaction signer |
| Match key | Registered by the owner for one match and signs that match's allowed trading actions |

The passkey flow creates ordinary secp256k1 accounts. Longshort does not deploy a Mera smart-account contract or send the derived secret to a custody service.

## Joining and trading

[actions.ts](../web/src/lib/actions.ts) creates a new match-key label before `createMatch` or `joinMatch`, derives its account, and passes its address as the player's `session`. When the join succeeds, Longshort stores the mapping from match ID to derivation label so that the same browser can reconstruct the registered trading key after unlocking.

The deployed [PerplArena](../contracts/src/PerplArena.sol) accepts the owner or registered session for that player's authorized round actions. Execution remains constrained by the arena and [MatchTradingAccount](../contracts/src/MatchTradingAccount.sol): the current live configuration is BTC Duel with fixed 5× leverage and isolated trading capital. Returned collateral always goes to the account's owner beneficiary.

Mera supplies the signer. Gas sponsorship is a separate Longshort integration: [relay.ts](../web/src/lib/relay.ts) signs the relay payload, [RelayDelegate.sol](../contracts/src/RelayDelegate.sol) validates it, and the keeper relayer pays transaction gas through EIP-7702. In the passkey flow, the owner can approve/join and the match key can trade without maintaining a player MON balance when the configured relay is available.

Browser-wallet and guest accounts remain alternative sign-in methods. Their storage and signing behavior is separate from this Mera keyring.

## Key lifetime and stored metadata

Passkey-derived owner and trading-key material stays in memory. Local storage contains credential identifiers/transports, the owner address used by wallet state, match derivation labels, and counters; it does not contain the passkey PRF output or these derived private keys.

`lock()` ends the owner and match signing sessions, clears the trade root, and tells wallet state that the account is locked. The keyring locks after 30 idle minutes and on `pagehide`; disconnecting also locks it. A running match pins the keyring to prevent the idle timer from interrupting the round. Unlocking again requires a passkey ceremony.

An owner account can be re-derived from the same passkey. Resuming an already registered match key also needs its derivation label, which this implementation stores in the browser. The product does not claim that clearing browser metadata preserves every in-progress match session.

## Device requirements and errors

The browser must be a secure context, such as HTTPS or localhost, with WebAuthn and a PRF-capable authenticator. Longshort distinguishes unavailable PRF support from a cancelled/failed passkey operation and shows an actionable sign-in error. Mera's [authenticator compatibility guidance](https://mera.category.xyz/authenticator-support/) describes platform support.

Signing in locally and on the production hostname uses different relying-party contexts. A local development credential is not a production sign-in credential.

## Implementation and verification

| Source | Responsibility |
| --- | --- |
| [mera.ts](../web/src/lib/mera.ts) | Passkey ceremony, HKDF labels, signing sessions, locking, and match-key metadata |
| [wallet.ts](../web/src/lib/wallet.ts) | Connect/unlock/disconnect, owner client, AUSD balances, and claim state |
| [actions.ts](../web/src/lib/actions.ts) | Register a match key and use its signer for round actions |
| [auth.ts](../web/src/lib/auth.ts) | Sign authenticated keeper requests with the connected account |
| [ConnectDialog.tsx](../web/src/components/ConnectDialog.tsx) | Passkey creation, returning-player sign-in, error display, and alternative wallet choices |
| [passkey-queue.test.ts](../keeper/test/passkey-queue.test.ts) | A Mera signing session authenticates, uses the sponsored fixture, and receives a multiplayer assignment |

The automated signing test uses a deterministic Mera session; it does not emulate a physical biometric or WebAuthn PRF ceremony. Device passkey prompts require a real-device check.

Related integrations: [Agora AUSD](AGORAUSD.md) is the owner's stake and trading asset; [Envio](ENVIO.md) indexes the resulting matches, fills, and payouts.
