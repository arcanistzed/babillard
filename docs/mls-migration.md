# Moving chat encryption to MLS

Status: proposal, with prototypes on the `mls-prototype` branch. Nothing here is in the app people use. Written 2026-11-13, revised 2026-11-16 after deciding on OpenMLS.

Chats today use the v1 envelope scheme in `packages/shared/src/e2ee.ts`. Every message gets a random key, and that key is wrapped once for every current device in the chat. It works, and it's simple. It has two weaknesses the README already admits. A stolen device key opens everything that device could ever read, because nothing ratchets. And the work and the envelope size grow with every phone in the chat.

MLS, defined in RFC 9420, fixes both. Group keys change with every membership change and old keys get deleted. A message is encrypted once for the group instead of once per phone, and a membership change costs about log(n) public-key operations. Babillard's groups of 4 to 8, with people coming and going, are the case MLS was designed for. Each chat already runs through one Durable Object, which is exactly the single orderer MLS needs.

This document settles which library to use, what the server does, how each feature maps onto MLS, and how existing chats move over. The last sections say what the prototypes proved and what's still open.

## Decisions

- Use **OpenMLS 0.9.2**, the only MLS library with an independent audit, compiled from Rust into a native Android library and called through a local Expo module. No WebAssembly: Hermes can't run it.
- There will be no paid review of our own. OpenMLS's audit is the outside scrutiny we get, so the cryptography lives entirely in OpenMLS. Our code passes bytes in and out and never touches a key.
- The ChatRoom Durable Object becomes the delivery service. It orders commits by epoch and never holds keys.
- Keep the v1 code and every device key, so that all existing history stays readable. Each chat switches to MLS once all of its members' phones can do MLS.

The first prototype used ts-mls. It stays on the branch as the reference for the design and for its tests, but it won't ship.

## Implementation choice

### What's available

| | ts-mls | OpenMLS | mls-rs |
|---|---|---|---|
| Language | TypeScript | Rust | Rust |
| Third-party audit | None. The README says so. | Yes, of the core. SRLabs, funded by the Sovereign Tech Agency, final report March 2026. Eight findings, one rated High. See below for scope. | **None.** Its README says it has passed RFC conformance checks but "has not yet received a full security audit by a 3rd party". |
| Runs in Hermes | Yes, with our own crypto adapter | As a native library | As a native library |
| Runs in Expo Go | Yes | No, needs a dev build | No, needs a dev build |
| Maintainers | Mostly one person | An established team, with public funding for the audit | AWS |

The brief assumed both Rust libraries were audited. Only OpenMLS is. mls-rs has no more independent review than ts-mls does.

What the OpenMLS audit covered, from the SRLabs report itself:

- The `openmls`, `traits` and `basic_credential` crates, "up to commit a3402f2 from 22nd of October 2025". The work ran 12 weeks from October 16, 2025, and the final report is dated March 11, 2026.
- Not in scope: "the crypto and storage providers". We use two of them, `openmls_rust_crypto` and `openmls_memory_storage`. SRLabs did run a differential fuzzer between the two crypto providers, which exercises them without reviewing them. `openmls_rust_crypto` is a thin layer over the RustCrypto crates (`hpke`, `ed25519-dalek`, `chacha20poly1305` and others).
- Findings: one High (MAC checks accepted truncated or empty tags), three Medium, two Low, two Informational. The High and Mediums were fixed for 0.8.1 and 0.7.3. One Low, S1-3, was only acknowledged. It says OpenMLS's state-changing calls aren't atomic, so a failed storage write leaves memory and disk disagreeing. Our wrapper sidesteps it: every call starts from saved bytes and its result is thrown away on error. That's the kind of application-side fix the report asks for.
- We use 0.9.2, which includes code written after the audited commit. The audit is strong evidence about the design and the core, not a guarantee about every line we run.

Sources: the [SRLabs report](https://blog.openmls.tech/SRL-OpenMLS_security_assurance_assessment.pdf), the [OpenMLS audit post](https://blog.openmls.tech/posts/2026-05-27-independent-audit/), the [mls-rs README](https://docs.rs/crate/mls-rs/latest/source/README.md), and the ts-mls README's "Security Disclaimer".

### Why OpenMLS

MLS is a long specification with many checks that must run when someone joins, leaves, or commits. A missed check is the typical bug, and it fails silently: messages keep flowing while a forged commit gets accepted. OpenMLS's High finding was that kind of bug, and it was found because someone outside looked. Our tests can show that a library works and interoperates. They can't show that it refuses everything it should. With no review of our own planned, the audited library is the only way to have that question looked at by someone who isn't us.

It also keeps the line clear. With ts-mls, we had to write our own crypto adapter (`packages/shared/src/mls/provider.ts`), because ts-mls's providers need `crypto.subtle` and Hermes has none. That adapter reached into `@hpke/common` internals and was unreviewed cryptographic plumbing. With OpenMLS, every cryptographic operation happens in its Rust code and its RustCrypto backend.

### How it's built

- `apps/mobile/modules/babillard-mls/rust` is a small crate on `openmls`, `openmls_rust_crypto`, `openmls_basic_credential` and `openmls_memory_storage`, all at exact versions. It exposes about ten functions: create an identity, create key packages, create a group, add, remove, update keys, join from a Welcome, encrypt, receive, and read the roster.
- Every call takes the phone's whole MLS state as bytes and returns the new state. If a call fails, the caller still has the old bytes, so nothing is half-applied. That's what lets the app save state and text in one transaction.
- Two rules come with that design.
  - **One call at a time per state.** If two calls start from the same bytes, one result overwrites the other. On the sending side that rewinds the key chain, so the app must queue calls per chat.
  - **Never roll back after encrypting.** Save the state `encrypt` returns before sending, and on a network error resend the same bytes. The server drops duplicates by `clientId`. Rolling back and encrypting something else would reuse a message key. Only a refused commit is rolled back: keep the old state, read the log, and commit again. If the outcome of a commit is unknown, keep both states until the log shows whether it landed.
- UniFFI generates the Kotlin bindings. A local Expo module (`android/.../BabillardMlsModule.kt`) exposes them to JavaScript as async functions, so the work runs off the JavaScript thread. UniFFI can generate Swift the same way when iOS comes.
- `rust/build-android.sh` builds the library with `cargo-ndk` for all four ABIs the release ships (arm64-v8a, armeabi-v7a, x86_64, x86) and regenerates the bindings. Gradle runs it before every Android build. The toolchain is pinned in `rust-toolchain.toml` at Rust 1.99.0.
- OpenMLS checks signatures, but deciding which key belongs to which person is the app's job. Every call that brings someone into view (adding, receiving a commit, joining from a Welcome) takes the server's device list and refuses anyone not on it. The Rust tests cover all three.

### What it costs

- Every Android build now needs Rust 1.99 with the Android targets, `cargo-ndk` 4, and the NDK. EAS's builders don't have Rust, so the EAS build needs a custom step that installs it, or the built `.so` files get committed. That's not decided yet.
- Expo Go can't load the module, so chat testing needs a dev build. The dev screen says so instead of crashing.
- The library adds 2.5 MB on arm64, 1.8 MB on 32-bit ARM, 3.0 MB on x86_64, and 3.4 MB on x86, before compression. Play delivers only the one a phone needs.
- The module isn't behind the prototype flag, only the screen is. Autolinking compiles it into every Android build from this branch, so any build now needs Rust. Merging the branch as it stands would ship the library in the next release, unused.
- Release builds minify. The module ships keep rules for JNA and UniFFI (`android/proguard-rules.pro`), but no release build has been run yet.
- If the library can't load on some phone, `isAvailable` is false and that phone stays on v1.
- Rust and NDK upgrades become routine upkeep. The exact pins mean an upgrade is always a deliberate edit.

## The server's role

The ChatRoom Durable Object is MLS's delivery service. It can't read any message, but it decides the order of commits, and that order is the group's history. This is built on the branch, behind `MLS_ENABLED`, which production's `wrangler.jsonc` sets to `"false"`. Every `/mls` route answers 404 when it's off.

### What it can see

Commits travel as MLS PublicMessages. `packages/shared/src/mlsWire.ts` reads them in plain TypeScript, with no MLS library and no keys. It extracts the chat, the epoch, the sender's leaf, the credentials of phones being added, and the leaves being removed. Application messages travel as PrivateMessages, and the server reads only their chat, epoch and content type.

Because it can read commits, the server keeps its own copy of the roster: which user and phone sits at each leaf. That makes it a gatekeeper as well as an orderer.

### The rules

`decide()` in `packages/shared/src/mlsDelivery.ts` is a pure function holding all of them. It's tested directly on real MLS messages.

- **Order.** A message is accepted only at the current epoch. A commit moves the epoch on by one. A phone that's behind gets `stale_epoch`, reads the log, and tries again.
- **Who can send.** The sender must be a current member, sending from one of their registered phones. A commit's sender leaf must be the submitting phone's leaf.
- **Creating the group.** The first commit must come from leaf 0 and carry an update path, whose leaf shows the creator's identity and key. Otherwise anyone could replay a creator's commit and claim leaf 0. OpenMLS always includes the path when adding.
- **Adds.** Only current members' registered phones, each matching the signing key on file, and none already in the group. New leaves follow RFC 9420: removals first, then each add takes the leftmost free leaf.
- **Removals.** Only phones that should be gone, because their owner left, was banned, or retired the phone. Members can't kick each other.
- **Pending removals hold messages.** While such a phone is still in the group, new messages are refused with `pending_removal`. The next sender must commit the removal first, which closes the window in which a departed phone still holds the current keys.
- **Update paths keep identity.** A committer's new leaf must keep its own identity and registered key.
- **Shape.** Commits must be public and application messages encrypted. Lone proposals, proposals by reference, update or other proposal types, and non-basic credentials are all refused.
- **Atomicity.** A commit that adds phones needs its Welcome, and they're stored together.
- **Readiness.** The first commit, which moves a chat to MLS, is refused with `not_ready` until every member of the chat has a registered MLS phone. After it, v1 is refused, so nobody may be left behind.
- **GroupInfo with every commit.** Every commit must carry the next epoch's GroupInfo, checked for the right chat and epoch. The server always holds a current one, so a phone can always join by itself.
- **External commits.** A member's registered phone that isn't in the group may add itself from the stored GroupInfo, with an external commit. It may remove only its own old leaf (a phone that lost its state rejoining), it must not already be in the group, and it lands on the leftmost free leaf, as OpenMLS places it. This is how a newcomer joins with nobody else online, and how a chat recovers when every phone in it is gone.

### What it stores

In the Durable Object's SQLite, apart from the `messages` table (`apps/api/src/do/mlsLog.ts`):

- `mls_log` holds every accepted commit and message in order, with sender, phone, and an optional `clientId` so a resend doesn't duplicate.
- `mls_roster` is the server's copy of who's at each leaf.
- `mls_welcomes` holds a Welcome per new phone, with the `seq` to read the log from.
- `mls_group_info` holds the GroupInfo every commit must carry, served only while it matches the current epoch.
- `mls_admitted` remembers every phone ever placed in the group, with the signing key it was admitted with. Old commits, Welcomes and GroupInfo trees name phones that have since left. Phones check that history against this list, and check new adds against the current directory.
- The epoch and the mode (`v1` until the first commit, then `mls`) are kept in the object's key-value storage.

`MlsLog.submit` is synchronous: the epoch check, the roster update and the insert happen with no `await` between them, because a Durable Object can take other requests while it awaits D1. D1 reads happen before it, and the inbox, unread counts and pushes after.

Commits stay apart from `messages` on purpose. Account deletion and block filtering edit `messages`. Applied to commits, those edits would break everyone's copy of the group. Commits carry no text, only membership changes and public keys.

Once a chat is in `mls` mode, the server refuses v1 envelopes in it, with `mls_mode`.

In D1, `device_keys` gains `mls_signature_key`, set once per phone, since changing it would change everyone's security code. A phone's MLS identity is `userId/deviceId`, where `deviceId` is its existing v1 public key. The new `mls_key_packages` table holds single-use packages, up to 100 per phone, plus one last-resort package that's never deleted. The server checks each upload is the phone's own, with its registered key and the right cipher suite. Claiming deletes the row, and whoever's delete succeeds gets it, so two people adding the same phone never share a package.

### Routes

| Route | What it does |
|---|---|
| `POST /mls/identity` | Registers a phone's signing key, once |
| `POST /mls/key-packages` | Uploads key packages and an optional last-resort one |
| `GET /mls/key-packages/:deviceId` | How many are left |
| `POST /mls/conversations/:id/key-packages` | Claims packages for members' phones, to add them |
| `GET /mls/conversations/:id` | Epoch, mode, roster, pending adds and removals, and the device directory phones check credentials against |
| `POST /mls/conversations/:id/messages` | Submits a commit, with Welcome and GroupInfo, or a message. Refusals the phone can fix come back as 409 |
| `GET /mls/conversations/:id/messages?since=` | The log after a sequence number |
| `GET /mls/conversations/:id/welcome/:deviceId` | The Welcome for one of the caller's own phones |
| `GET /mls/conversations/:id/group-info` | The latest GroupInfo |

Open sockets get `{ type: "mls", seq, epoch }` after each accepted entry. Everyone gets every entry, blockers included, because skipping entries would break their copy of the group.

`packages/shared/test/mlsOpenmls.test.ts` replays real OpenMLS messages, written by a Rust test, through the same rules. The server's roster matches OpenMLS's leaf by leaf through adds, a removal, a new member reusing the freed leaf, a key update, an external join, a phone rejoining in its own place, and a message.

`apps/api/test/mls.e2e.ts` runs the routes through the real Worker, with ts-mls phones:

- The routes are off without the flag.
- A key package uploaded under the wrong phone is refused, a second signing key is refused, and packages can only be claimed for phones waiting to join.
- A direct chat forms, both sides send and read, and a resend with the same `clientId` isn't stored twice.
- A message from an old epoch is refused, and v1 is refused once the chat is on MLS.
- In a four-person group, after someone leaves, messages wait until their phone is removed, kicking a current member is refused, and the leaver can no longer read the log.
- A chat stays on v1 while one member has no MLS phone, and moves once they do.
- A member's new phone joins by itself from the stored GroupInfo, the other member applies the external commit later, and the new phone reads what follows.

## The phone's side

Built on the branch, and wired into the chat screens behind the prototype flag.

### The sync engine

`packages/shared/src/mlsClient.ts` is the phone's MLS logic, with no platform code in it. `MlsMessenger` keeps a phone's groups in step with the server:

- `ensureIdentity` creates the phone's identity, registers its signing key, and keeps 10 key packages on the server. Each private half is saved before its public half is uploaded.
- `sync` brings one chat up to date.
  - If nobody has made the group, it makes it with an empty commit whose update path proves who made it. If the server answers `not_ready`, the chat stays on v1 and the engine waits.
  - If the phone isn't in the group, it joins from a waiting Welcome, or failing that by itself from the stored GroupInfo.
  - It reads the log from its cursor. For each entry it saves the new state, the cursor and any text in one step.
  - Then it does the chores: commits the removal of phones that should be gone, and adds members' phones waiting to join.
- `send` syncs first, encrypts, saves the new state and the pending message before sending, then submits. On `stale_epoch` or `pending_removal` it catches up, does the chores, and encrypts again. A message that couldn't be sent over the network stays pending with its exact bytes, and `retryPending` resends those bytes.
- Every operation goes through one queue, because the state is one blob.
- It checks the server's label for who sent a message against MLS's authenticated sender, and refuses a mismatch.
- It checks credentials in the group's history (commits it reads, the tree in a Welcome or GroupInfo) against every phone the server has ever admitted to the chat. Phones it adds must be in today's directory. Without the history list, a phone that was offline while someone joined and left could never catch up, and nor could a newcomer whose Welcome predates a departure.
- If registering its signing key fails, the identity is already saved, so the next `ensureIdentity` retries with the same key.
- If another phone has already added someone, the server refuses this phone's claim for them. The engine treats that like a lost race: it reads the log and looks again.
- **A commit whose answer never comes back.**
  - Before submitting any commit, the engine records it, with the state it would lead to and its epoch.
  - Every operation starts by settling such records. If the server's epoch hasn't moved, or the log shows someone else's commit at that epoch, the record is dropped and the phone carries on from its old state. If the log shows this phone's own commit, the phone applies everything before it with the old state, then takes up the recorded one.
  - The state is one blob for every chat, so nothing else may run until this is settled. Taking up an old snapshot later would undo another chat's progress. If the server can't be reached, every operation fails until it can.
- **A message whose answer never came back** stays pending with its exact bytes. When it shows up in the log as this phone's, with the same `clientId`, it's marked sent. `retryPending` resends any still pending, and the server drops duplicates.
- **An entry that won't apply.** Applying an entry is deterministic, so if the same entry fails twice, the engine stops retrying. It drops its copy of the group and rejoins by itself with an external commit that replaces its own old leaf. OpenMLS does that by matching the signing key, and the server allows exactly that self-removal. Messages sent between the bad entry and the rejoin stay unreadable on that phone, and nobody else is affected.

It runs on three interfaces:
- `MlsCrypto`: `nativeCrypto` on the phone, over the OpenMLS module. `tsMlsCrypto` in tests, over ts-mls. Its states are immutable snapshots, so old bytes stay valid, as the engine needs.
- `MlsTransport`: `httpMlsTransport` over the `/mls` routes. The in-memory `MemoryMlsServer` applies the same `decide()` rules as the Durable Object.
- `MlsStore`: `SqlMlsStore`, described next.

### Storage

`packages/shared/src/mlsSqlStore.ts` is the store, written against a four-method SQL interface. On the phone, `expo-sqlite` (added as a dependency) fills that interface. In tests, Node's built-in SQLite does. The MLS state and every message's text are sealed with XChaCha20-Poly1305 under a 32-byte key kept in SecureStore, and each value is bound to its row, so rows can't be swapped. Every change runs in one exclusive transaction. "Forget this phone" on account deletion now also deletes the database and its key. Android backup leaves the database alone: the backup rules the app ships with expo-secure-store include only shared preferences.

### How it's tested

- Store tests on Node's SQLite cover:
  - the round trip
  - nothing readable in the raw database
  - a wrong key failing
  - swapped rows detected
  - a write that fails halfway leaving nothing behind
- An engine test runs three phones against the in-memory server: the group forms by itself, Carol leaves, and Bob's next message removes her phone first.
- Failure tests against the in-memory server:
  - A phone that was offline catches up past someone who joined and left.
  - A newcomer joins from a Welcome issued before someone left.
  - A new phone joins by itself while a departed phone is still in the group.
  - Registration fails once, then succeeds.
  - A send fails on the network and `retryPending` delivers it exactly once.
  - Two phones do the same chore at once.
  - A claim is refused because another phone got there first.
  - A commit lands but its answer is lost: the phone takes up its state on the next operation.
  - A commit never reaches the server while another phone takes that epoch: the phone drops it and redoes the chore.
  - A message lands but its answer is lost: it's marked sent from the log and isn't sent twice.
  - An entry fails twice: the phone rejoins by itself and reads what follows.
- Two end-to-end tests run engines with encrypted SQLite stores against the real Worker:
  - A four-person group forms by itself, delivers messages, removes a departed member before the next message, agrees on the security code, and tops key packages back up.
  - A chat waits until both people can do MLS, then a member's new phone joins by itself and reads what follows.
- The dev screen's "Run sync engine demo" runs the three-phone demo on the device, on OpenMLS and real `expo-sqlite` databases. It passed on the x86_64 emulator in a debug build, in 3.6 s. Most of that was 1.3 s for three phones to make and upload 30 key packages, and each later sync or send took 180 to 390 ms.
- The dev screen's "Run recovery demo" runs the three recovery cases on the device, also on OpenMLS and `expo-sqlite`. In it, Alice's commit adding Carol lands but its answer is lost, Alice's next send takes up that commit, a message whose answer was lost is marked sent, and Bob's phone fails one entry twice and then rejoins by itself. It passed on the emulator: Bob's phone appeared once in the roster after rejoining, it read the next message, and all three security codes matched. The shared tests run the same scenario on ts-mls, with both the memory store and the SQL store on `node:sqlite`.

### In the app

When the flag is on and the native library loaded, `mlsMessenger(userId)` in `apps/mobile/src/mls/index.ts` opens the user's encrypted database and runs `ensureIdentity`. Then:

- `useChat` syncs the engine when the chat opens and whenever the socket says `mls`. It puts the stored MLS messages in the same timeline as v1 history and system messages, ordered by server time, since the two logs number entries separately. Once this phone is in the chat's group it sends through the engine. Until then it sends v1, which the server accepts only while the chat is still on v1. If the log removes this phone, the chat closes as it does when someone is removed.
- The inbox shows an MLS chat's latest message from the phone's own store. The server keeps no preview for those.
- The chat info screen shows the security code from the phone's own MLS group once it's in one, and the v1 code before that.

With the flag off, `mlsMessenger` returns null and the screens behave exactly as before. The one shared change is that the timeline is now sorted by server time instead of v1's sequence number. Both come from the same Durable Object's clock, so for a v1-only chat the order is the same.

To try it on a device:
1. Run a local Worker with `DEV_MODE=true` and `MLS_ENABLED=true`.
2. Run `tsx scripts/mls-peer.ts http://localhost:8787` from `apps/api`. It creates Alice and Bob with a direct chat, prints a link that signs the phone in as Alice, and plays Bob on the engine (with ts-mls).
3. Open the printed links on the phone.

Tried this way on the emulator:
- The phone's first sync created the group.
- Bob joined from his Welcome and said hello. It arrived through the socket's `mls` event.
- The phone sent "ping", Bob answered "pong", and both showed in the chat.
- The phone's security code matched Bob's, and the inbox previewed "pong from Bob".

A group was tried the same way, with `apps/api/scripts/mls-group-peers.ts` playing Bob, Carol and Dave in a four-person group with the phone as Alice:
- Until the phone had registered, the server refused the others' attempts to start the group with `not_ready`. Once it had, the group formed, and the phone showed all three hellos.
- The phone sent "ping", which all three read, and Bob's "pong" showed on the phone.
- Blocking Carol from her profile, with "Just block Carol", hid her earlier hello at once. Her next message reached Bob and Dave but not the phone's screen, and the inbox showed no preview while her message was the latest.
- Dave left. Bob's next message removed Dave's phone first, which left 3 phones at epoch 3. The phone showed "Dave left" and the notice, its info screen listed 3 people, and its security code changed to match Bob's new one.
- Unblocking Carol brought both of her messages back in place.

### Not done on the phone

- **Being removed.** The engine stops with an error when the log removes this phone. The chat screen needs to show that the person left or was removed.
- **Typing and sending states.** A message sent with MLS shows as pending until the engine returns, with no echo over the socket. That's fine on a quick connection and untested on a slow one.
- **New phones and recovery in the app.** A second phone for the same person joining by external commit, and the recovery cases, have run in the engine on the emulator, but not through the chat screens with a live Worker. Nothing has run on a real ARM phone.
- **Franking for reports, backup v2, and per-chat state** remain as designed above.

## Before turning it on

The flag hides the routes, but not everything:

- **Deploy order.** Migration `0010` must be applied before this Worker is deployed. Account deletion now also deletes key packages, and that fails without the table. Every `ChatRoom` also creates its empty MLS tables when it wakes, flag or not. That's harmless, but it means the branch changes production storage the moment it's deployed.
- **New members after the switch.** The readiness check covers the moment a chat moves to MLS. Someone who joins an open group later with an app that can't do MLS would be stuck. Before the flag goes on, `ANDROID_MIN_VERSION` must require an MLS-capable app.
- **Phones that are gone but not retired.** A phone is retired only when someone has more than five, so a lost phone stays "active" and keeps its leaf. Nothing breaks, but those leaves never go away. The app needs a way to retire a phone, such as a list of signed-in phones under You, and then the server's pending-removal rule takes care of the group.
- **Directory refresh.** Phones check every credential against the server's directory. A phone must fetch the directory again before applying new commits, or it will refuse a member's new phone. The end-to-end test client does this.
- **Burned packages.** A commit the server refuses has already used the key packages it claimed. The last-resort package covers the gap, but phones should top up when `GET /mls/key-packages/:deviceId` runs low.

## How each feature works under MLS

### Who is a member: credentials and the security code

Each phone is one MLS member, a leaf in the tree. Its credential is a basic credential `userId/deviceId` plus its own Ed25519 signing key. The phone accepts a credential only if the server's device list has that signing key for that user and device. In the Rust wrapper, that's the `trusted` list every add, receive, and join takes.

That means the server still vouches for which phones belong to whom, just as it hands out public keys today. A server that lies can still add a phone of its own. MLS doesn't remove that power. What catches it, as now, is the security code.

The security code becomes `rosterCode()`: a hash of every member's user, device, and signing key, sorted. It stays the same across epochs, so it doesn't change every time someone sends an update. It changes only when a phone joins or leaves, which is when people ought to compare again. The ts-mls tests check both properties of the code, and the Rust test `updating_keys_moves_the_epoch_and_keeps_the_roster` checks that OpenMLS's roster doesn't change on a key update. On the emulator, OpenMLS and ts-mls phones in the same group computed the same code. It should **not** come from MLS's epoch authenticator, which changes with every commit.

### Groups forming

The Cohort Durable Object creates a group in D1 while nobody is looking at their phone. Under MLS a phone has to create the group:

1. The server writes the conversation as now. `GET /mls/conversations/:id` lists every member's phone under `pendingAdds`.
2. The first member to open the chat claims key packages for the others and submits the epoch-0 commit that adds them all. The server accepts the first epoch-0 commit and refuses later ones with `stale_epoch`. A later phone then finds its Welcome waiting instead.

Until then, the chat shows "Waiting for someone in the group to open the chat". The system message about the group opening is written by the server, as now, and isn't encrypted.

### Someone joins an open group

`tryJoinOpenGroup` adds the D1 row, and the newcomer's phones show up in `pendingAdds`. Two ways to finish it:

- **External commit, which I recommend.** The new member's phone fetches the latest GroupInfo from the Durable Object and adds itself. The Durable Object serves GroupInfo only to people D1 lists as members. Nobody else needs to be online.
- The next member who opens the chat adds them with a normal commit. Both are built, so the app can do whichever comes first.

Either way the newcomer reads only from their join onward, the same as today.

The server's power here equals what it has now. It can let in whoever it likes, and the roster code shows it.

### Someone leaves, is banned, or deletes their account

An MLS member can't commit their own removal. So:

1. The server removes the D1 row, kicks their sockets, and stops serving them the log, as it does now. Their phones show up in `pendingRemovals`, because they're in the roster but not the directory.
2. While a removal is pending, the Durable Object refuses **application** messages with `pending_removal`. The next phone that tries to send first commits the removal, then sends. Both halves are built and covered by `apps/api/test/mls.e2e.ts`.

So a departed member's keys stop opening anything new from the first message after they leave. Between the leave and that next message, nothing new is sent. Until then the removed phone could decrypt only if it got ciphertext from somewhere, and the server no longer gives it any. The Rust test `a_removed_phone_cannot_read_what_follows` checks the cryptographic half: after Carol's phone applies her own removal, it can't open the next message.

An alternative is to make the Durable Object an MLS external sender with its own signing key, allowed to propose removals. It removes the dependence on a member sending, but it puts a signing key on the server, and phones still have to commit the proposal. Not worth it for now.

Blocking doesn't change membership in groups, the same as today. Today the server leaves the blocked person's messages out of the blocker's history. Under MLS that's risky. Each sender's messages form a chain, and OpenMLS will skip ahead at most 1,000 steps in one chain by default. If the server hid 1,001 messages and the person was later unblocked, their next message wouldn't open. So the server delivers everything, and the blocker's phone reads the blocked person's messages and hides them on screen. Commits always have to be delivered anyway, because skipping one breaks the blocker's copy of the group.

How it's built:

- **The rule.** `showsSender` in `packages/shared/src/rules/blocking.ts` decides who a phone shows messages from. Its tests are in `blocking.test.ts`.
- **Hidden on screen, not deleted.** The phone keeps the text in its encrypted store and hides it when showing the chat. Unblocking brings the messages back, which matches v1, where the server filters history each time it's read. The cost is that the blocker's phone holds the blocked person's words, encrypted at rest like everything else in the store.
- **The block list on the phone.** `useBlockedIds` reads `GET /safety/blocks` through the same query the Blocked screen uses. Blocking from the report screen and unblocking both refresh it. The last list is saved on the phone in expo-sqlite's key-value store, so hiding still works offline, and "forget this phone" deletes it. Until the phone has learned the list once, MLS chats show only the user's own messages.
- **The inbox.** A preview is left out when the latest message is from someone blocked, as the server does for v1. That covers both the server's last sender and the phone's last stored message.
- **The server's part.** MLS entries from a blocked person don't raise the blocker's unread count and don't push to them. Both go through the same code as v1. An end-to-end test checks the unread count.

### Several phones per person

Each phone is its own member. A new phone joins each of its owner's chats by external commit, authorized because the device list has it. When a device is retired, by `MAX_DEVICES_PER_PERSON` or at sign-out, the server adds an `mls_pending` removal for it in each chat.

People notice nothing different. A new phone reads new messages and not old ones, unless they restore a backup. See below.

### Decrypting once, and local history

This is the biggest change for the app, and the brief didn't list it. MLS deletes each message key after use. A phone can open a message **once**. The Rust test `each_message_opens_once` shows the second attempt fails.

Today `useChat` and the inbox fetch ciphertext again and decrypt it every time the screen opens. Under MLS the phone needs:

- **Stored group state.** In the OpenMLS prototype, one blob holds everything a phone has: its signing key, its unused key packages, and every group. That was about 12.8 KB with one three-member group. Production should keep one blob per chat, or use OpenMLS's SQLite storage, so a message in one chat doesn't rewrite the rest. It holds private keys. SecureStore is meant for values under about 2 KB, so encrypt the state under a key kept in SecureStore and store the result in the message database, saving it after every message processed.
- **A local message store.** `expo-sqlite` holding the text each phone decrypted, read by the chat screen and the inbox. The server's copy only feeds phones that haven't caught up.
- **A sync loop.** Read the log from the phone's last `seq`, apply each entry in order, then save the new state, the text, and the cursor in one SQLite transaction. If the app dies halfway through, the same entry gets applied again, which fails, so the save has to be atomic. That means the encrypted state blob lives in the same database as the messages, not in a separate file.

OpenMLS by default tolerates 5 messages out of order within one sender and skips ahead at most 1,000, and it keeps no keys from past epochs. Phones read the log in order, and the server only accepts messages at the current epoch, so none of those limits come up. Keeping no past epochs is the strictest setting for forward secrecy.

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

Nothing else in the chat becomes readable, the same as today. The wrapper's `encrypt` already takes the `aad` and `receive` returns it, so the commitment is ready to wire up.

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

## What the prototypes prove

Branch `mls-prototype`. Nothing in the normal app paths changed.

### OpenMLS on Android

- `apps/mobile/modules/babillard-mls/rust/src/tests.rs` has eleven Rust tests. They cover:
  - two phones trading messages
  - state surviving a save and reload byte for byte, and truncated state being refused
  - each message opening once
  - a failed call leaving the old state usable
  - a removed phone that can't read on, whether or not it applied its removal
  - a losing commit being dropped and retried
  - key updates moving the epoch without changing the roster
  - IDs containing slashes being refused
  - a credential the device list doesn't vouch for being refused by the committer, by other members, and by a phone joining from a Welcome
- `apps/mobile/src/mlsNative.ts` runs on the phone. Alice and Bob use OpenMLS through the native module, and every message they send passes the server's ordering check (`admit`). Then Alice adds Carol, who runs ts-mls.

On the `Local_Reader_API_36` emulator, in a debug build with the module, it passed twice:

- Bob read all three messages, and Alice read both of hers.
- Carol joined from OpenMLS's Welcome on ts-mls and read OpenMLS's message. Alice and Bob read Carol's reply.
- All three phones showed the same security code, and the server's epoch ended at 2.

Two independent implementations agreeing on every message is good evidence that our wrapper uses OpenMLS correctly and speaks standard MLS.

Timings from the second run:

| Step | Time |
|---|---|
| Create two identities | 31 ms |
| Alice starts the group | 40 ms |
| Alice adds Bob, making the commit and Welcome | 88 ms |
| Bob joins from the Welcome | 70 ms |
| Alice sends | 37 ms |
| Bob reads | 88 ms |
| Bob replies | 62 ms |
| Alice reads | 59 ms |
| Alice adds Carol | 70 ms |

Most of each call is the bridge, not the cryptography. Every call copies the whole state, about 12.8 KB for Alice with three members, through base64 both ways. Storing state per chat, or using OpenMLS's SQLite storage, would shrink that. On the first run, creating identities took 518 ms while the native library loaded.

The release library is 2.9 MB for x86_64.

### The earlier ts-mls prototype

- `packages/shared/src/mls/` wraps ts-mls, with our own crypto adapter for Hermes in `provider.ts`, the ordering rule in `delivery.ts`, and a demo in `demo.ts`.
- `packages/shared/test/mls.test.ts` has ten tests. They include a canary showing ts-mls's own crypto providers fail without WebCrypto, and an interop test against ts-mls's WebCrypto provider.
- In Expo Go, its two-member demo took 493 ms warm. The emulator reported `Hermes: true`, `crypto.getRandomValues: false`, and `crypto.subtle: false`.

The ordering rule `admit` and the security-code function `codeForRoster` are worth keeping. The rest won't ship. `admit` uses ts-mls only to parse message headers, which a short TypeScript reader can replace.

### On the dev screen and the build

- `apps/mobile/app/dev-mls.tsx` runs both demos. It redirects home unless the build sets `EXPO_PUBLIC_MLS_PROTOTYPE=1`. It's reachable only by deep link (`babillard://dev-mls` in a dev build) and isn't linked from anywhere. In Expo Go, the OpenMLS button says the module isn't in the build.
- The flag hides the screen but doesn't keep code out of the build. Metro bundles every route, so merging this branch as it stands would ship ts-mls inside the app, unused. Delete the route before merging.
- `apps/mobile/metro.config.js` maps five modules that ts-mls and `@hpke` import dynamically to empty modules. It can go when ts-mls does.

### What they don't prove

- Two real devices through a real Durable Object. The server is built and tested end to end, but with ts-mls phones in Node, not the app's OpenMLS module. OpenMLS output is checked against the server's rules by replaying a recorded session, not live.
- External commits, franking, the phone's storage and sync loop, backup, and migration. Those are designed above and not built.
- Performance on a real phone, or with 8 members.
- Anything on ARM. All four ABIs compile, but only the x86_64 library has run, on the emulator. Nothing has run on a real phone yet.

## What's left, and roughly how long

One developer who knows the codebase. Done on the branch since the first estimate: the server's header reader, the key package service, the delivery service, the readiness check, external commits with GroupInfo export, the phone's sync engine with its encrypted SQLite store, the chat screens on MLS behind the flag, recovery from lost answers and stuck entries, and hiding blocked people's MLS messages.

| Work | Estimate |
|---|---|
| Android build in EAS: install Rust there, or commit the built libraries | 2 to 3 days |
| Server, still to do: rate-limiting key package claims, and a way for people to retire a lost phone | 1 to 2 days |
| Rust wrapper: last-resort key packages and per-chat state | 2 to 4 days |
| Phone: a second phone for the same person, and the chat screen's handling of being removed | 1 to 2 days |
| Franking for reports | 2 days |
| Roster security code on the chat info screen | 1 day |
| Backup v2 and history store | 5 to 7 days |
| Migration: dormant release, per-chat switch, version gate, mixed timeline | 3 to 5 days |
| Removing ts-mls and its adapter from the app once the native path covers everything | 1 day |
| End-to-end tests with two devices, and on a real phone | 4 to 5 days |
| **Total** | **about 4 to 5 weeks** |

iOS isn't in this estimate. It would add a Swift module over the same Rust crate.

## Open security questions

1. **Our wrapper is the unaudited part.** It's small and does no cryptography, but it decides which credentials to trust and how state is saved. Keep it small, keep its tests, and read every change to it carefully.
2. **The server still decides who's a member.** MLS doesn't change that. The roster code is the only check, as today. Key transparency would be the real fix, and it's a big project.
3. **The removal window.** It closes at the next message after someone leaves. Check that the server really stops serving the log to someone the moment their D1 row is gone, including over an open socket.
4. **Forward secrecy versus local storage.** The local message store and the optional history store keep plaintext, or something that opens to plaintext, on purpose. That limits what MLS forward secrecy buys on a seized, unlocked phone. Decide whether to offer disappearing messages.
5. **Post-compromise security needs updates.** A phone that never commits never refreshes its own leaf key. Have each phone call `update_keys` when it opens a chat and hasn't committed in a week.
6. **Key package exhaustion.** If someone's packages run out, they can't be added until they come online. Keep one long-lived "last resort" package per phone, a common MLS practice, and accept that a join using it has weaker forward secrecy.
7. **Group state at rest.** It holds every private key for the group. It needs the same care as the SecureStore keys, and it must never go into a backup.
8. **Keeping up with OpenMLS.** Its fixes only help if we take them. Watch its security advisories and update the pins promptly, rerunning the Rust tests each time.
9. **Draining key packages.** A member can claim packages for any phone waiting to join, and a commit the server then refuses still uses them up. A hostile member could drain a newcomer's packages that way. The last-resort package keeps the phone addable. Claims still need a rate limit.
10. **The roster is the server's word.** It follows the commits the server accepted, and phones keep their own roster from the same commits. If they ever disagree, a phone should stop and show the security code, not trust either side.

The D1 migration on the branch is `0010`. Main has moved on since the branch started, so check the number before merging.
