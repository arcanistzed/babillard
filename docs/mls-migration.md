# Moving chat encryption to MLS

Status: proposal, with a prototype on the `mls-prototype` branch. Nothing here is in the app people use. Written 2026-11-13.

Chats today use the v1 envelope scheme in `packages/shared/src/e2ee.ts`. Every message gets a random key, and that key is wrapped once for every current device in the chat. It works, and it's simple. It has two weaknesses the README already admits. A stolen device key opens everything that device could ever read, because nothing ratchets. And the work and the envelope size grow with every phone in the chat.

MLS, defined in RFC 9420, fixes both. Group keys change with every membership change and old keys get deleted. A message is encrypted once for the group instead of once per phone, and a membership change costs about log(n) public-key operations. Babillard's groups of 4 to 8, with people coming and going, are the case MLS was designed for. Each chat already runs through one Durable Object, which is exactly the single orderer MLS needs.

This document settles which library to use, what the server does, how each feature maps onto MLS, and how existing chats move over. The last sections say what the prototype proved and what's still open.

## Recommendation in short

- Build on **ts-mls 1.6.4** in JavaScript, with our own crypto provider on `@noble`. Ship it as a beta behind a server flag.
- Before MLS becomes the default for everyone, pay for an **independent review** of the ts-mls paths we use, our provider, and our server glue.
- Keep OpenMLS behind a native module as the fallback. The wire format is standard MLS, so the server and the protocol design don't change if we swap libraries later.
- The ChatRoom Durable Object becomes the delivery service. It orders commits by epoch and never holds keys.
- Keep the v1 code and every device key, so that all existing history stays readable. Each chat switches to MLS once all of its members' phones can do MLS.

## Implementation choice

### What's available

| | ts-mls | OpenMLS | mls-rs |
|---|---|---|---|
| Language | TypeScript | Rust | Rust |
| Third-party audit | None. The README says so. | Yes. SRLabs, funded by the Sovereign Tech Agency, published May 2026. Eight findings, one rated High, seven fixed by the time of the post. | **None.** Its README says it has passed RFC conformance checks but "has not yet received a full security audit by a 3rd party". |
| Runs in Hermes | Yes, with our provider. Proven on the emulator. | Only as a native module | Only as a native module |
| Runs in Expo Go | Yes | No, needs a dev build | No, needs a dev build |
| Ready-made mobile bindings | Not needed | None official | `mls-rs-uniffi` for Kotlin and Swift |
| Maintainers | Mostly one person | An established team, with public funding for the audit | AWS |

The brief assumed both Rust libraries were audited. Only OpenMLS is. That changes the comparison. mls-rs has no more independent review than ts-mls does, so it beats ts-mls only on maturity and backing. It's not "audited versus unaudited".

Sources: the [OpenMLS audit post](https://blog.openmls.tech/posts/2026-05-27-independent-audit/), the [mls-rs README](https://docs.rs/crate/mls-rs/latest/source/README.md), and the ts-mls README's "Security Disclaimer".

### What each one costs

**ts-mls.** It's the cheapest to adopt, and the riskiest to trust.

- It doesn't run on Hermes out of the box. Both of its crypto providers, including the one called `nobleCryptoProvider`, go through `@hpke/core`. That library does X25519 key generation and HKDF through `crypto.subtle`, and Hermes has no `crypto.subtle`. The prototype's canary test pins this down. With only `getRandomValues` available, ts-mls's own provider fails at the first step: `Cannot read properties of undefined (reading 'generateKey')`.
- So we wrote `packages/shared/src/mls/provider.ts`, about 150 lines. It uses `@noble` for signatures, hashing, HKDF and the AEAD, the same audited code v1 uses. For HPKE it keeps `@hpke/core`'s key schedule, swaps in `@hpke/dhkem-x25519`'s pure-JS X25519, and replaces the WebCrypto HMAC inside HKDF with `@noble/hashes`. A test runs it against ts-mls's WebCrypto provider in both directions, which shows the two produce the same protocol.
- That provider is our own code doing cryptographic plumbing, and it depends on two `@hpke/common` internals, `HkdfSha256Native` and `Dhkem`. A ts-mls or `@hpke` upgrade could break it quietly. Pin exact versions, as the branch does, and keep the interop test. ts-mls 1.6.4 also lists exact `@noble` versions as peers, `@noble/curves` 2.0.1 and `@noble/ciphers` 2.1.1, while the repo uses 2.4.0. pnpm warns about it. Our provider calls `@noble` directly, and the ts-mls code that would import those peers never runs, so it's only a warning for now.
- It runs anywhere JavaScript runs: Expo Go, dev builds, Node tests, and the Worker if we ever need it there.
- ts-mls's default authentication service accepts **any** credential. `clientConfig()` in `group.ts` replaces it. Tests check that ts-mls really calls it in all three places: the phone adding someone, every other member applying that commit, and a new phone joining from a Welcome. Forgetting this anywhere would let anyone the server introduces join silently. It's the most dangerous default in the library.
- A ts-mls review should look hardest at secret-tree handling, epoch key retention, commit validation, and the ratchet-tree checks in `joinGroup`. OpenMLS's own problems were in these areas: a 2025 advisory about persisting the secret tree, and MAC checking, which was the audit's one High finding. That's where a newer library is most likely to be wrong too.

**OpenMLS through a native module.** It's the most trustworthy core, with real build and maintenance cost.

- We would write a small Rust crate exposing the dozen operations in `group.ts`, bind it with `uniffi-bindgen-react-native` as a Turbo Module, and implement OpenMLS's storage trait over a file or SQLite.
- Every build needs the Rust toolchain and the Android NDK for each ABI, plus Xcode targets once iOS exists. EAS builds need a custom build step or prebuilt `.aar` and `.xcframework` files kept in the repo.
- Expo Go stops working, so every test of chat needs a dev build. The project already uses dev builds, but the emulator here wipes installed apps on each boot, so each session starts with an install.
- The APK grows by a few megabytes per ABI.
- My estimate is three to five extra weeks on top of the JS plan, then ongoing upkeep: Rust upgrades, NDK changes, and FFI bugs that only show up on one platform.
- The server side is the same either way. The Durable Object only reads message headers, and `readFrame` does that with no crypto.

**mls-rs through a native module.** Same costs as OpenMLS, minus some binding work thanks to `mls-rs-uniffi`. Since it has no audit either, I don't see a reason to pick it over OpenMLS for this.

### Why ts-mls first

The threat that matters most here is a stolen or seized phone reading months of group history. MLS forward secrecy fixes that with either library. The question is whether an unaudited implementation adds more risk than the old scheme it replaces. v1 is also unaudited. It's our own design on audited primitives, which is the same position ts-mls plus our provider would be in.

The native route costs about a month of work before anyone sees a benefit, and it locks testing to dev builds. I'd rather spend part of that money on a focused review of ts-mls and our glue. That buys most of the assurance for less, and the protocol design here doesn't change if the review says to switch.

Conditions on that choice:

1. MLS stays behind a server flag, on for test accounts only, until the review is done and its findings are fixed.
2. Versions stay pinned exactly. Upgrades get the interop test and the canary test, plus a read of the ts-mls changelog.
3. If the review finds structural problems, or ts-mls stops being maintained, we move to OpenMLS. Moving would mean re-forming each group: someone commits a fresh group and the server marks the old one closed. The wire format, the server, and the app's flows stay as they are.

## The server's role

The ChatRoom Durable Object becomes MLS's delivery service. It can't read anything. It decides the order of commits, and that order is the group's history.

### What it stores

New tables in the Durable Object's SQLite, separate from `messages`:

- `mls_log (seq, epoch, kind, sender_id, sender_device, bytes, created_at)` holds every commit and application message in order. `kind` is `commit` or `application`.
- `mls_state` is a single row with the current `epoch`, plus `mode`, which is `v1` or `mls`.
- `mls_welcomes (device_id, seq, bytes)` holds Welcomes waiting for a new phone.
- `mls_group_info (epoch, bytes)` holds the latest GroupInfo, which phones upload after each commit. It lets a phone join by itself with an external commit.
- `mls_pending (kind, user_id, device_id)` lists adds and removals the server wants and no phone has committed yet.

Commits stay apart from the `messages` table on purpose. Today `eraseUser` deletes a person's rows, `around()` serves windows of history, and history is filtered for blocks. All of that is fine for application messages. Applied to commits, it would break the chain for everyone else. Commits carry no message text, only membership changes and fresh public keys, so they're kept for as long as the chat exists.

D1 gets a key package table, `mls_key_packages (device_id, user_id, bytes, created_at)`. Each phone uploads about 10 and tops them up. Claiming one deletes it in the same statement, so no package gets used twice. The device list grows a `signature_key` column, or a sibling `mls_devices` table: the Ed25519 public key that goes in the phone's MLS credential.

### Ordering

`admit()` in `packages/shared/src/mls/delivery.ts` holds the whole rule:

- Anything that doesn't parse as an MLS message for this chat is refused.
- A commit is accepted only if its epoch equals the current epoch. Then the epoch goes up by one.
- An application message is accepted only at the current epoch. A phone that's behind gets `stale_epoch`, reads the log, and sends again. That's the same retry the app does for `stale_keys` today.
- Lone proposals are refused. Proposals go inside commits.

Commits travel as MLS PublicMessages, so the server can read the epoch and content type. Their contents are only membership changes and public keys, which the server already knows from D1. Application messages travel as PrivateMessages.

One Durable Object detail matters. The epoch check and the insert must run in one synchronous block. `postUserMessage` awaits D1 several times, and while a Durable Object awaits D1 it can start other requests. Read the epoch, check, and insert with no `await` in between. The D1 work for previews, unread counts, and push can stay after the insert, as it is now.

A commit and its Welcome are accepted together or not at all.

### What it no longer does

It no longer checks that an envelope covers every current device, so `stale_keys` and `unknown_device` go away. In MLS the group is whoever the last commit says it is.

## How each feature works under MLS

### Who is a member: credentials and the security code

Each phone is one MLS member, a leaf in the tree. Its credential is a basic credential `userId/deviceId` plus its own Ed25519 signing key. The phone's `AuthenticationService` accepts a credential only if the server's device list has that signing key for that user and device. That's `clientConfig()`.

That means the server still vouches for which phones belong to whom, just as it hands out public keys today. A server that lies can still add a phone of its own. MLS doesn't remove that power. What catches it, as now, is the security code.

The security code becomes `rosterCode()`: a hash of every member's user, device, and signing key, sorted. It stays the same across epochs, so it doesn't change every time someone sends an update. It changes only when a phone joins or leaves, which is when people ought to compare again. A test checks both properties. It should **not** come from MLS's epoch authenticator, which changes with every commit.

### Groups forming

The Cohort Durable Object creates a group in D1 while nobody is looking at their phone. Under MLS a phone has to create the group:

1. The server writes the conversation with `mode = mls` and an `mls_pending` add for every member's phone.
2. The first member to open the chat claims key packages for the others and submits the epoch-0 commit that adds them all. The server accepts the first epoch-0 commit and refuses later ones.
3. Everyone else sees a Welcome waiting and joins from it.

Until then, the chat shows "Waiting for someone in the group to open the chat". The system message about the group opening is written by the server, as now, and isn't encrypted.

### Someone joins an open group

`tryJoinOpenGroup` adds the D1 row and an `mls_pending` add. Two ways to finish it:

- **External commit, which I recommend.** The new member's phone fetches the latest GroupInfo from the Durable Object and adds itself. The Durable Object serves GroupInfo only to people D1 lists as members. Nobody else needs to be online.
- The next member who opens the chat adds them with a normal commit.

Either way the newcomer reads only from their join onward, the same as today.

The server's power here equals what it has now. It can let in whoever it likes, and the roster code shows it.

### Someone leaves, is banned, or deletes their account

An MLS member can't commit their own removal. So:

1. The server removes the D1 row, kicks their sockets, and stops serving them the log, as it does now. It writes an `mls_pending` removal.
2. While a removal is pending, the Durable Object refuses **application** messages with `pending_removal`. The next phone that tries to send first commits the removal, then sends.

So a departed member's keys stop opening anything new from the first message after they leave. Between the leave and that next message, nothing new is sent. Until then the removed phone could decrypt only if it got ciphertext from somewhere, and the server no longer gives it any. The test "shuts out someone who was removed" checks the cryptographic half: after Carol's phone applies her own removal, it can't open the next message.

An alternative is to make the Durable Object an MLS external sender with its own signing key, allowed to propose removals. It removes the dependence on a member sending, but it puts a signing key on the server, and phones still have to commit the proposal. Not worth it for now.

Blocking doesn't change membership in groups, the same as today. Today the server leaves the blocked person's messages out of the blocker's history. Under MLS that's risky. Each sender's messages form a chain, and ts-mls will skip ahead at most 200 steps in one chain. If the server hid 201 messages and the person was later unblocked, their next message wouldn't open. So the server should deliver everything, and the blocker's phone should process the blocked person's messages and throw the text away. Commits always have to be delivered anyway, because skipping one breaks the blocker's copy of the group.

### Several phones per person

Each phone is its own member. A new phone joins each of its owner's chats by external commit, authorized because the device list has it. When a device is retired, by `MAX_DEVICES_PER_PERSON` or at sign-out, the server adds an `mls_pending` removal for it in each chat.

People notice nothing different. A new phone reads new messages and not old ones, unless they restore a backup. See below.

### Decrypting once, and local history

This is the biggest change for the app, and the brief didn't list it. MLS deletes each message key after use. A phone can open a message **once**. The test "opens each message once" shows the second attempt fails.

Today `useChat` and the inbox fetch ciphertext again and decrypt it every time the screen opens. Under MLS the phone needs:

- **Stored group state.** About a kilobyte for two members in the prototype, and it grows with the group. It holds private keys. SecureStore is meant for values under about 2 KB, so encrypt the state under a key kept in SecureStore and store the result in the message database, saving it after every message processed.
- **A local message store.** `expo-sqlite` holding the text each phone decrypted, read by the chat screen and the inbox. The server's copy only feeds phones that haven't caught up.
- **A sync loop.** Read the log from the phone's last `seq`, apply each entry in order, then save the new state, the text, and the cursor in one SQLite transaction. If the app dies halfway through, the same entry gets applied again, which fails, so the save has to be atomic. That means the encrypted state blob lives in the same database as the messages, not in a separate file.

ts-mls keeps keys for 4 past epochs and 10 generations by default, so messages that arrive a little out of order still open. Within one sender it will skip ahead at most 200 messages. Phones read the log in order, so they don't hit that limit.

### Key backup

Today the backup file holds device keys, and old messages open again because the server still has the envelopes. Under MLS the server's ciphertext can't be opened later by anyone. The keys are gone, by design. So "back up my keys" no longer means anything for MLS messages. Restoring MLS group state from a backup would also be wrong, since it would reuse keys.

The replacement keeps today's experience: a small file and a passphrase, with history coming back on a new phone.

- Each person gets a random **history key**. The backup file, version 2, holds the v1 device keys as now, plus the history key. Same scrypt and XChaCha20-Poly1305.
- After a phone decrypts a message, it encrypts the text under the history key and uploads it to an `mls_history` store that only that person can read.
- A new phone restores the file, downloads that store, and joins its chats fresh by external commit.

That store is deliberately **not** forward secret. Anyone with the history key and the server's copy can read that person's archive. It's the same property today's backup has, but now it's opt-in. People who never set up a backup get full forward secrecy. The key backup screen should say so plainly.

### Reports to moderators

Today the reporter hands over a message's `contentKey`. The server decrypts the stored envelope with it and confirms the text. MLS has no per-message key that the server could use like that.

Use **message franking** instead:

- The sender picks a random 32-byte franking key for each message, puts it inside the encrypted message with the text, and puts `HMAC-SHA256(frankingKey, conversationId ‖ senderId ‖ text)` in the MLS `authenticated_data`. That field travels in the clear and the AEAD binds it.
- The Durable Object stores that commitment with the message.
- Phones check the commitment against what they decrypted, and show the message as unverifiable if it doesn't match.
- A reporter sends the text and the franking key. The server recomputes the HMAC and compares it with what it stored from the sender's own socket.

Nothing else in the chat becomes readable, the same as today. `ts-mls`'s `createApplicationMessage` already takes `authenticatedData`.

### Previews and push

Push stays "New message" with the sender's name. Inbox previews come from the local message store instead of decrypting `lastMessageEnvelope` again. The server stops storing an envelope for previews and keeps only who sent the last message and when.

## Moving existing chats over

Goal: nobody loses history they can read today.

1. **Keep v1 for reading, indefinitely.** `openMessage`, every device key in SecureStore, and v1 backups stay. Old envelopes stay in `messages` and open exactly as now. Nothing gets re-encrypted.
2. **Ship the MLS code dormant.** One release that creates the phone's MLS identity and uploads key packages, without using them. The server records which devices have key packages.
3. **Switch one chat at a time.** The Durable Object flips a chat to `mls` once every current member has at least one phone with key packages. The first member to open it afterwards creates the group, as in "Groups forming". From then on the server refuses new v1 envelopes in that chat.
4. **Bring up the stragglers.** Once most phones have the release, raise `ANDROID_MIN_VERSION` so the rest must update. Until then a chat with one old phone stays on v1. That's fine, because v1 still works.
5. **History in the app.** The chat screen shows v1 messages above MLS ones in a single timeline, ordered by `seq` across both tables. The v1 security code stays visible for the old part until the switch, then the roster code takes over.

Rollback: before step 4, a chat can go back to v1 by flipping `mode`. MLS messages sent meanwhile stay readable on the phones that already decrypted them into their local stores.

## What the prototype proves

Branch `mls-prototype`. Nothing in the normal app paths changed.

- `packages/shared/src/mls/provider.ts` is the cipher suite for Hermes, `MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519`.
- `packages/shared/src/mls/group.ts` wraps ts-mls: devices, key packages, groups, add, remove, Welcome, encrypt, receive, save and load state, roster code, and a header reader for the server.
- `packages/shared/src/mls/delivery.ts` has the ordering rule and an in-memory stand-in for the Durable Object.
- `packages/shared/src/mls/demo.ts` runs two phones through that stand-in, with a save and reload in the middle.
- `packages/shared/test/mls.test.ts` has ten tests:
  - the two-member demo with `crypto.subtle` removed, as on Hermes
  - a canary showing ts-mls's own noble provider still fails without WebCrypto
  - interop with ts-mls's WebCrypto provider, in both directions
  - each message opens once
  - a removed member can't read what follows, whether or not their phone applied the removal
  - two commits racing for one epoch: the second is refused, catches up, and gets in
  - a credential the device list doesn't vouch for is refused by the committer, by other members, and by a phone joining from a Welcome
  - the roster code holds across epochs and changes when someone joins
  - the server refuses foreign, wrong-chat, and stale messages
- `apps/mobile/app/dev-mls.tsx` is a screen that runs the demo on a phone. It redirects home unless the build sets `EXPO_PUBLIC_MLS_PROTOTYPE=1`. It's reachable only by deep link, `exp://<metro>/--/dev-mls`, and isn't linked from anywhere. The flag hides the screen but doesn't keep code out of the build. Metro bundles every route, and the route's `import()` with it, so merging this branch as it stands would ship ts-mls inside the app, unused. Delete the route before merging, or accept that.
- `apps/mobile/metro.config.js` maps five modules to empty modules. ts-mls and `@hpke` import them dynamically for unused cipher suites, or as a Node fallback. Without that Metro can't bundle. The mapping applies to every build, flag or not, which is harmless because nothing else imports those names.

On the `Local_Reader_API_36` emulator in Expo Go 58, the screen reported `Hermes: true`, `crypto.getRandomValues: false`, `crypto.subtle: false`. So Hermes really does lack both, and the app supplies `getRandomValues` from expo-crypto. The demo passed there. Timings on the emulator:

| Step | First run | Second run |
|---|---|---|
| Create two phones' key packages | 480 ms | 131 ms |
| Alice starts the group | 15 ms | 3 ms |
| Alice adds Bob, making the commit and Welcome | 245 ms | 131 ms |
| Bob joins from the Welcome | 202 ms | 140 ms |
| Both save and reload their state | 4 ms | 2 ms |
| Alice sends | 21 ms | 11 ms |
| Bob reads | 44 ms | 27 ms |
| Bob replies | 17 ms | 9 ms |
| Alice reads | 36 ms | 29 ms |
| Total, including loading ts-mls the first time | 2576 ms | 493 ms |

Both runs ended with each phone reading the other's message and showing the same security code. The saved group state was about 1.2 KB.

These come from a development bundle, which isn't minified and runs Hermes without precompiled bytecode, on an emulator with a desktop CPU. A mid-range phone will be slower. Commits for 8 members do more public-key work than the 2-member demo, so measure on a real phone before relying on these.

It does **not** prove:

- two real devices through a real Durable Object. Both phones run in one process, against the in-memory stand-in.
- anything about the Worker side, key package handling, external commits, or franking. Those are designed above and not built.
- the security of ts-mls. Tests show it works and interoperates, not that it's safe against an attacker.

## What's left, and roughly how long

One developer who knows the codebase, after the review decision:

| Work | Estimate |
|---|---|
| Device signing keys and the key package service, D1 and endpoints | 3 to 4 days |
| Durable Object delivery service: log, epoch check, Welcomes, GroupInfo, pending adds and removals, socket events | 5 to 7 days |
| Phone: encrypted state file, local message store, sync loop, send and retry, joining by Welcome and external commit, committing pending removals | 8 to 12 days |
| Franking for reports | 2 days |
| Roster security code on the chat info screen | 1 day |
| Backup v2 and history store | 5 to 7 days |
| Migration: dormant release, per-chat switch, version gate, mixed timeline | 3 to 5 days |
| End-to-end tests with two devices, and on a real phone | 4 to 5 days |
| **Total** | **about 6 to 9 weeks** |

Add the independent review: two to four weeks on the calendar, partly overlapping with the above. Going straight to OpenMLS adds three to five weeks.

## Open security questions

1. **ts-mls has no audit,** and our provider is new code. The review should cover both, plus `admit`, `clientConfig`, and the sync loop's atomicity.
2. **Are the `@hpke` packages reviewed?** I haven't found an audit of hpke-js. We use its key schedule and its pure-JS X25519.
3. **The server still decides who's a member.** MLS doesn't change that. The roster code is the only check, as today. Key transparency would be the real fix, and it's a big project.
4. **The removal window.** It closes at the next message after someone leaves. Check that the server really stops serving the log to someone the moment their D1 row is gone, including over an open socket.
5. **Forward secrecy versus local storage.** The local message store and the optional history store keep plaintext, or something that opens to plaintext, on purpose. That limits what MLS forward secrecy buys on a seized, unlocked phone. Decide whether to offer disappearing messages.
6. **Post-compromise security needs updates.** A phone that never commits never refreshes its own leaf key. Have each phone send an empty commit, an update, when it opens a chat and hasn't committed in a week.
7. **Key package exhaustion.** If someone's packages run out, they can't be added until they come online. Keep one long-lived "last resort" package per phone, a common MLS practice, and accept that a join using it has weaker forward secrecy.
8. **Ed25519 strictness.** `@noble/curves` verifies with ZIP-215 rules by default. That's fine while everyone runs the same code. If we ever mix implementations, check that they agree on edge-case signatures.
9. **Group state at rest.** It holds every private key for the group. Its file needs the same care as the SecureStore keys, and it must never go into a backup.
