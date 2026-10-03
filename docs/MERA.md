# How Longshort uses Mera

Longshort uses [Mera by Category Labs](https://github.com/category-labs/mera) as its account layer for new live Duels. Players create or sign in with a passkey; the application derives separate owner and match-trading keys. A live round accepts repeated trades without another passkey prompt. A separate PRF namespace encrypts the player's private thesis and reflection beside the public match report.

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

[actions.ts](../web/src/lib/actions.ts) creates a random, deployment-scoped public label before `createMatch` or `joinMatch`, derives its account, and passes its address as the player's `session`. Before sending the entry transaction, it saves the label under the owner and session addresses in the keeper's durable `passkey_match_keys` table. Writes require owner authentication and cannot replace an existing label. A failed metadata write prevents the entry transaction from being sent.

When the join succeeds, Longshort also caches the match-to-label mapping locally. The cache is optional: a new browser discovers the passkey without a saved credential ID, reconstructs the owner, reads the player's registered session from `getPlayers`, retrieves its public derivation label, and accepts the derived key only if its address matches the onchain session. A changed label or a different passkey cannot substitute a signer. The onchain check is cached for the lifetime of that unlocked keyring and seat, so repeated round actions do not repeat recovery reads.

Owner and trade-root derivation remain unchanged from the original integration, preserving existing account addresses. Legacy match labels are uploaded when an unlocked player opens an active round or first uses its validated signer. An old label that was lost before it was uploaded cannot be reconstructed from the session address alone.

The deployed [PerplArena](../contracts/src/PerplArena.sol) accepts the owner or registered session for that player's authorized round actions. Execution remains constrained by the arena and [MatchTradingAccount](../contracts/src/MatchTradingAccount.sol): the current live configuration is BTC Duel with fixed 5× leverage and isolated trading capital. Returned collateral always goes to the account's owner beneficiary.

Mera supplies the signer. Gas sponsorship is a separate Longshort integration: [relay.ts](../web/src/lib/relay.ts) signs the relay payload, [RelayDelegate.sol](../contracts/src/RelayDelegate.sol) validates it, and the keeper relayer pays transaction gas through EIP-7702. In the passkey flow, the owner can approve/join and the match key can trade without maintaining a player MON balance when the configured relay is available.

The live sign-in dialog offers Mera creation and returning-passkey sign-in, including when credential metadata is absent. Existing browser-wallet/guest accounts retain [a separate recovery page](https://longshort.fun/recover) to view balances, finish rounds and recover capital. It preserves their original accounts and never generates a replacement guest secret; these accounts cannot enter new live Duels or claim welcome AUSD. Unauthenticated Practice remains available with simulated positions.

## Paid-entry consent and round sessions

A passkey verification permits one paid-entry attempt within two minutes. This lets a newly signed-in player enter immediately without another prompt. A later entry, an expired entry approval, or a locked keyring requires fresh passkey verification. Selecting a different passkey during an unlock stops the action instead of silently spending from another account.

Token approvals are limited to that entry plus its separate trading budget, including replacement of an existing unlimited approval. A live 5 AUSD duel approves 105 AUSD; the entry transaction spends that amount. Claiming test tokens does not consume the paid-entry approval.

Round controls use the registered match signing session without repeated ceremonies. Its authority comes from the arena's owner/session binding and round rules, rather than an allowlist implemented by the Mera signing primitive. A session cannot move the owner's stake, redirect returned collateral, or authorize an entry for its owner. The application ends a settled round's signing session after its gas-sweep attempt. The contract rejects trading outside the round's permitted state.

## Key lifetime and stored metadata

Passkey-derived owner and trading-key material stays in memory. Local storage contains credential identifiers/transports, the owner address used by wallet state, and match derivation labels; it does not contain the passkey PRF output or these derived private keys. New match labels use cryptographic randomness instead of a browser counter. Keeper recovery records contain only chain ID, arena, owner/session addresses, public label, and creation time. They are untrusted hints, not custody data.

`lock()` ends the owner and match signing sessions, clears the trade root, drops the journal key reference, and tells wallet state that the account is locked. The keyring locks after 30 idle minutes and on `pagehide`; disconnecting also locks it. Countdown/live phases pin the keyring against idle locking; waiting for a rival or settlement does not pin it indefinitely. Unlocking again requires a passkey ceremony. Successful lobby departure ends its round signer. Fresh verification of the same account preserves existing round signers and an open journal while renewing the one-entry consent.

An owner and registered match signer can be re-derived from the same passkey plus the durable public hint after browser storage is cleared. The passkey must be accessible on that device and use the same relying-party context. Missing or withheld recovery hints can prevent session recovery; altered hints cannot produce an accepted signer. Legacy sessions require their old label to have been uploaded before clearing its last browser copy.

Returning to an active round with a locked keyring shows a resume action and explains that the round and any open position remain live. No background task opens a passkey sheet just to restore the account display.

## Device requirements and errors

The browser must be a secure context, such as HTTPS or localhost, with WebAuthn and a PRF-capable authenticator. Longshort distinguishes unavailable PRF support from a cancelled/failed passkey operation and shows an actionable sign-in error. Mera's [authenticator compatibility guidance](https://mera.category.xyz/authenticator-support/) describes platform support.

Mera's [creation implementation](https://github.com/category-labs/mera/blob/main/library/src/passkey.ts) uses a fallback assertion when PRF is unavailable during creation. That can add a second prompt. The one-prompt requirement must therefore be verified on the actual demo authenticator, rather than inferred from one SDK call. A callsign is optional and does not add a required onboarding step.

Signing in locally and on the production hostname uses different relying-party contexts. A local development credential is not a production sign-in credential.

## Private match journal: non-account PRF work

[journal.ts](../web/src/lib/journal.ts) evaluates the same passkey through Mera with the separate namespace `longshort.fun/private-match-journal/prf/v1`. Its deterministic SHA-256 salt is distinct from the original account salt; neither owner nor trade-root derivation changes. HKDF-SHA256 derives a **non-extractable AES-256-GCM key** through Web Crypto, with deployment and owner included in the key context. Opening the journal requires an explicit verification even when the account is already unlocked.

Each encryption uses a fresh random 12-byte nonce and a 128-bit authentication tag. Authenticated additional data binds version, namespace, chain, arena, owner and match ID. Altered ciphertext/nonce or a substituted match/owner/deployment fails authentication. PRF and temporary plaintext byte buffers are cleared; the CryptoKey and React draft stay in memory and are discarded on lock/account change. No plaintext or encryption key is sent to the keeper or browser storage.

The keeper's `private_journals` table stores only ciphertext envelopes, public context and revision timestamps. Owner-authenticated saves require onchain participation in that match. Compare-and-swap revisions reject stale saves with HTTP 409. The UI preserves an unsaved draft for conflict review, explicitly distinguishes failed sync, and checks the returned revision and exact ciphertext before displaying “Saved to encrypted storage.” A lost response is reconciled by reading that exact ciphertext rather than assuming the save failed or succeeded.

This is non-account use of PRF material. Actual same-passkey decryption in a fresh synced profile remains a physical acceptance requirement; the automated crypto fixture cannot certify passkey synchronization or novelty.

## Onboarding measurements

[Demo evidence](https://longshort.fun/demo) keeps measurements in this tab's memory: elapsed time from page navigation, trusted control activations, actual native WebAuthn create/get attempts, and successful receipt hashes. Funding, approval, entry and trades are recorded separately. The first owner-authorized transaction is approval or entry, not the server-funded AUSD transfer. Downloads contain public addresses/receipts and browser details, never keys, PRF or journal plaintext.

[passkeyClient.ts](../web/src/lib/passkeyClient.ts) observes the SDK's actual native calls, including a creation fallback or cancellation. API ceremony counts can differ from the number of OS sheets; visible prompts require observation. Reloading resets measurements, so collect the original tab's evidence before the stateless test.

## Implementation and verification

| Source | Responsibility |
| --- | --- |
| [mera.ts](../web/src/lib/mera.ts) | Passkey ceremony, HKDF labels, signing sessions, locking, and match-key metadata |
| [wallet.ts](../web/src/lib/wallet.ts) | Connect/unlock/disconnect, owner client, AUSD balances, and claim state |
| [actions.ts](../web/src/lib/actions.ts) | Register a match key and use its signer for round actions |
| [auth.ts](../web/src/lib/auth.ts) | Sign authenticated keeper requests with the connected account |
| [ConnectDialog.tsx](../web/src/components/ConnectDialog.tsx) | Mera-only live sign-in, discoverable returning sign-in, and handled errors |
| [passkeys.ts](../keeper/src/passkeys.ts) | Authenticated, immutable public derivation hints, scoped to deployment and owner |
| [passkey-recovery.test.ts](../keeper/test/passkey-recovery.test.ts) | Durable hint reads from a fresh client, authentication, immutability, deployment isolation, and malformed-input rejection |
| [mera.test.ts](../web/test/mera.test.ts) | Actual Mera derivation/signing with fixture WebAuthn: erased storage, changed hints, wrong passkey, key lifetime, entry consent, and bounded token approvals |
| [journal.ts](../web/src/lib/journal.ts), [PrivateJournal.tsx](../web/src/components/match/PrivateJournal.tsx) | Separate PRF namespace, authenticated encryption, explicit unlock and truthful save/conflict UI |
| [keeper journal.ts](../keeper/src/journal.ts) | Ciphertext-only durable storage, match membership and revision checks |
| [journal.test.ts](../web/test/journal.test.ts) | Real Mera PRF evaluation and AES-GCM with fixture WebAuthn; reconstruction, tampering, context isolation and lock races |

Regression tests, both type checks and the production web build passed before deployment. Live integration checks exercised real match #6, its six Perpl fills, cache-loss recovery using the actual web signer code, persisted ciphertext recovery, full AUSD reconciliation and Envio agreement. Its [settlement transaction](https://testnet.monadscan.com/tx/0x4adf6eb6a403f119879936eb5a2ba20cc5ceddeba73cdd6c806d4ff16e8c53ea) is public. Authenticated requests and socket credentials also remain usable in memory when browser storage is unavailable, without extra ceremonies; sign-out clears that token cache.

These tests use WebAuthn fixtures and cannot verify physical prompts, synced passkeys, or UI onboarding timing. For live acceptance, count the visible onboarding prompts and retain the Demo evidence before clearing site storage. During an active round, clear local storage, reload, sign in with the same passkey and confirm the same owner, position and another trade. Check lock/resume and cancellation, then save a journal and verify the same owner, history and journal return in a fresh browser profile using the same synced passkey. These physical checks remain required before asserting complete bounty acceptance.

Related integrations: [Agora AUSD](AGORAUSD.md) is the owner's stake and trading asset; [Envio](ENVIO.md) indexes the resulting matches, fills, and payouts.
