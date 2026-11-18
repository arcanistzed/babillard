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

- Every Android build now needs Rust 1.99 with the Android targets, `cargo-ndk` 4, and the NDK. EAS's builders have the NDK but not Rust, so `apps/mobile/scripts/eas-install-rust.sh` runs as EAS's `eas-build-pre-install` hook: it installs rustup, the toolchain pinned in `rust-toolchain.toml` with its targets, and `cargo-ndk`, and skips what's already there. No built libraries are committed. Tried in a clean Ubuntu 24.04 container with this machine's NDK: the hook ran, a second run reused everything, and the release library for x86_64 built in 52 seconds, so all four ABIs should add a few minutes to a build. Not yet tried on EAS itself.
- `APP_VARIANT=mlstest` builds a separate test app, `com.babillard.mlstest` with the link scheme `babillard-mlstest` and no Firebase, which installs beside the real app. The `mls-test` EAS profile builds it as a debug dev client pointed at `http://localhost:8787`, for trying the branch on a real phone through `adb reverse` without touching the installed app.
- Expo Go can't load the module, so chat testing needs a dev build. In Expo Go, `isAvailable` is false and chats stay on v1.
- The library adds 2.5 MB on arm64, 1.8 MB on 32-bit ARM, 3.0 MB on x86_64, and 3.4 MB on x86, before compression. Play delivers only the one a phone needs.
- Autolinking compiles the module into every Android build from this branch, so any build now needs Rust. The library ships dormant: the app uses it only once the server says MLS is on.
- Release builds minify. The module ships keep rules for JNA and UniFFI (`android/proguard-rules.pro`), but no release build has been run yet.
- If the library can't load on some phone, `isAvailable` is false and that phone stays on v1.
- Rust and NDK upgrades become routine upkeep. The exact pins mean an upgrade is always a deliberate edit.

## The server's role

The ChatRoom Durable Object is MLS's delivery service. It can't read any message, but it decides the order of commits, and that order is the group's history. This is built on the branch, behind `MLS_ENABLED`, which production's `wrangler.jsonc` sets to `"false"`. It takes three values:
- `"true"`: MLS is on, and chats move to it as their members become ready.
- `"paused"`: chats already on MLS carry on as normal, including new phones joining them, but no other chat moves. The server refuses a group's first commit with `not_ready`, which phones already read as "wait".
- Anything else is off: every `/mls` route answers 404.

`/me` says `mls: true` when the value is `"true"` or `"paused"`, and the app uses MLS only then. See "Rolling it out" for when each is safe.

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
- **Readiness.** The first commit, which moves a chat to MLS, is refused with `not_ready` until every member of the chat has a registered MLS phone, and every member but its author has one with a key package waiting. After it, v1 is refused, so nobody may be left behind. The key package matters because a phone registers its signing key a moment before its packages go up: a creator who started in that moment couldn't add the phone, and would send its first messages without it (found on the emulator, below).
- **GroupInfo with every commit.** Every commit must carry the next epoch's GroupInfo, checked for the right chat and epoch. The server always holds a current one, so a phone can always join by itself. The server reads the whole GroupInfo and refuses one without exactly one `external_pub` holding a length-prefixed key of the right size, since a phone joining by itself needs that key. (See "ts-mls and `external_pub`" below.)
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
| `POST /mls/conversations/:id/key-packages` | Claims packages for members' phones, to add them. Limited per chat and phone, and per person (below) |
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
- One chat takes at most 3 fresh packages for a phone in 10 minutes. After that, claims get the phone's last-resort package, which isn't used up, and none once that's gone.
- A direct chat forms, both sides send and read, and a resend with the same `clientId` isn't stored twice.
- A message from an old epoch is refused, and v1 is refused once the chat is on MLS.
- In a four-person group, after someone leaves, messages wait until their phone is removed, kicking a current member is refused, and the leaver can no longer read the log.
- A chat stays on v1 while one member has no MLS phone, and moves once they do.
- A member's new phone joins by itself from the stored GroupInfo, the other member applies the external commit later, and the new phone reads what follows.

## The phone's side

Built on the branch, and wired into the chat screens, which use it once the server says MLS is on.

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
- The dev screen's "Run sync engine demo", since removed from the app, ran the three-phone demo on the device, on OpenMLS and real `expo-sqlite` databases. It passed on the x86_64 emulator in a debug build, in 3.6 s. Most of that was 1.3 s for three phones to make and upload 30 key packages, and each later sync or send took 180 to 390 ms.
- Its "Run recovery demo" ran the three recovery cases on the device, also on OpenMLS and `expo-sqlite`. In it, Alice's commit adding Carol lands but its answer is lost, Alice's next send takes up that commit, a message whose answer was lost is marked sent, and Bob's phone fails one entry twice and then rejoins by itself. It passed on the emulator: Bob's phone appeared once in the roster after rejoining, it read the next message, and all three security codes matched. The shared tests run the same scenario on ts-mls, with both the memory store and the SQL store on `node:sqlite`.

### In the app

When `/me` says `mls: true` and the native library loaded, `mlsMessenger(me)` in `apps/mobile/src/mls/index.ts` opens the user's encrypted database and runs `ensureIdentity`. A build-time flag no longer decides this, so a release can carry MLS dormant until the server switches it on. Then:

- `useChat` syncs the engine when the chat opens and whenever the socket says `mls`. It puts the stored MLS messages in the same timeline as v1 history and system messages, ordered by server time, since the two logs number entries separately. Once this phone is in the chat's group it sends through the engine. Until then it sends v1, which the server accepts only while the chat is still on v1. If the log removes this phone, the chat closes as it does when someone is removed.
- The inbox shows an MLS chat's latest message from the phone's own store. The server keeps no preview for those.
- The chat info screen shows the security code from the phone's own MLS group once it's in one, and the v1 code before that.

With MLS off on the server, `mlsMessenger` returns null and the screens behave exactly as before: the app opens no MLS database and makes no MLS request. The one shared change is that the timeline is now sorted by server time instead of v1's sequence number. Both come from the same Durable Object's clock, so for a v1-only chat the order is the same.

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

A person's second phone was tried with `apps/api/scripts/mls-second-phone.ts`. Alice's first phone (scripted) and Bob move their direct chat to MLS, and then stay quiet while the emulator signs in as Alice, so nobody can add the new phone:
- The new phone joined by itself with an external commit. The server's group went to 3 phones with no adds waiting.
- It showed what Bob and Alice's first phone sent after it joined, with the first phone's message on Alice's side. What was sent before it joined doesn't show: a new phone can't read MLS history until backup v2 exists.
- Its "ping" reached both Bob and Alice's first phone, and Bob's "pong" came back.
- All three phones showed the same security code.

**ts-mls and `external_pub`.** The first try failed on the device: OpenMLS couldn't read the GroupInfo the ts-mls phones had uploaded. RFC 9420 section 12.4.3.2 makes the `external_pub` extension a length-prefixed key, and OpenMLS writes it that way. ts-mls 1.6.4, the latest stable release, writes and reads the bare key. That agrees with itself, so every test with only ts-mls phones passed, but OpenMLS can't read it. Phones in production would all run OpenMLS, so this only broke tests that mix the two. Three changes:
- `patches/ts-mls@1.6.4.patch`, applied by pnpm, makes ts-mls write and read the field as the RFC has it.
- The server refuses a GroupInfo whose `external_pub` isn't well formed, so no client, whatever its library, can leave the group with one a new phone can't join from.
- Tests: `mlsWire.test.ts` checks the server's refusal, and `mlsOpenmls.test.ts` has a ts-mls phone join by itself from a GroupInfo OpenMLS made.

### Being out of a chat

When the person is no longer in a chat, the phone deletes its MLS copy of it: the group, the stored messages, the cursor and any commit in flight, in one step (`forgetChat`). That matches v1, where the server stops showing a chat to someone once they're out of it. Decided on 2026-11-17: the phone deletes it, rather than keeping the history as some apps do.

- **What counts as out.** Only the server's own answers: 404 `conversation_not_found` or 410 `conversation_closed` from the chat or MLS routes, or the socket closing with code 4001. A bare 404 from an MLS route never counts, because every MLS route answers 404 while MLS is switched off on the server, and a rollback mustn't erase every chat.
- **On the chat screen.** The chat closes with "You're no longer in this chat", which doesn't say who or why: in an MLS chat the removal commit comes from whichever phone wrote next. Someone who taps "Leave group" themselves sees no notice.
- **While the app wasn't open.** Each time the inbox loads, the phone checks every chat it holds MLS data for that isn't in the list. It asks the server about each one first, so a stale list can't delete a chat the person is still in, and a chat it can't check right now is kept.
- **Removed from the group but still in the chat.** When the log removes this phone, the engine drops its copy of the group at once and syncs again: if the person is still in the chat, the phone joins again. If not, the server says so and the chat closes as above.
- **A commit in flight.** If the person leaves a chat while one of their commits in it has no answer yet, the record is dropped when the server says they're out. Before this, it would have stopped every operation in every chat.

Tried on the emulator with `apps/api/scripts/mls-group-peers.ts` (its new "remove me" makes Alice leave from her other session):
- With the group open, Alice leaving elsewhere closed the chat with the notice, and the inbox showed no chats. The phone's database, copied off the emulator, went from one cursor and two messages for that chat to nothing.
- In a second group, tapping "Leave group" went straight to the inbox with no notice, and the database went from three messages to nothing.
- The engine tests cover rejoining after removal while still a member, a commit in flight for a chat the person left, and the inbox check given an empty list. The SQL store test covers forgetting one chat and keeping another.

### Not done on the phone

- **Typing and sending states.** A message sent with MLS shows as pending until the engine returns, with no echo over the socket. That's fine on a quick connection and untested on a slow one.
- **Recovery in the app.** The recovery cases have run in the engine on the emulator, but not through the chat screens with a live Worker. Nothing has run on a real ARM phone.
- **Backup v2 and per-chat state** remain as designed above.

## Before turning it on

The flag hides the routes, but not everything:

- **Deploy order.** Migrations `0010` and `0011` must be applied before this Worker is deployed. `0011` matters even with MLS off: leaving a group, blocking someone and deleting an account all delete from `mls_history`, so without the table those break for everyone.
- **Migration numbers.** Main already has `0010` to `0013`, so the branch's two migrations and drizzle's journal need regenerating when it's merged.
- **The privacy policy** now says that saving a backup keeps a sealed copy of the person's messages on the server, and for how long (9ccdb7a), and `LEGAL_VERSION` is 2026-11-18, so everyone agrees again (70c2b9b). That wording is only true once MLS is on. If the dormant release ships first, it would ask people to agree to something that isn't happening yet, so release these two commits with the switch-on, or reword the policy for the dormant release.
- **Storage on deploy.** Account deletion also deletes key packages, which fails without `0010`'s table. Every `ChatRoom` also creates its empty MLS tables when it wakes, flag or not. That's harmless, but it means the branch changes production storage the moment it's deployed.
- **New members after the switch.** The readiness check covers the moment a chat moves to MLS. Someone who joins an open group later with an app that can't do MLS would be stuck. Before the flag goes on, `ANDROID_MIN_VERSION` must require an MLS-capable app. See "Rolling it out".
- **Phones that are gone but not retired.** A phone is retired only when someone has more than five, so a lost phone stays "active" and keeps its leaf. Nothing breaks, but those leaves never go away. The app needs a way to retire a phone, such as a list of signed-in phones under You, and then the server's pending-removal rule takes care of the group.
- **Directory refresh.** Phones check every credential against the server's directory. A phone must fetch the directory again before applying new commits, or it will refuse a member's new phone. The end-to-end test client does this.
- **Burned packages.** A commit the server refuses has already used the key packages it claimed. Phones don't upload a last-resort package yet. They refill from `GET /mls/key-packages/:deviceId` when the app opens and on a sync at most every 10 minutes.

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

The replacement keeps today's experience: a small file and a passphrase, with history coming back on a new phone. Built on the branch as described below (7c2e8f0 and the fixes after it). The code is `packages/shared/src/mlsHistory.ts`, the engine's history methods in `mlsClient.ts`, the `/mls/history` routes, and the key backup screen.

**The idea.** Each person who turns backup on gets a random 32-byte **history key**. Their phones encrypt each MLS message they read or send under it and upload the result to a store only that person can read. A new phone restores the file, downloads the store, and fills in what was said before it joined.

That store is deliberately **not** forward secret: anyone with the history key and the server's copy can read that person's archive. It's the same property today's backup has, but now it's opt-in. People who never set up a backup get full forward secrecy, and the backup screen should say so plainly.

#### The file

- Version 2 holds the v1 device keys as now, plus the history key, with the same scrypt and XChaCha20-Poly1305. The plaintext becomes `{ deviceKeys, historyKey }`.
- `openKeyBackup` reads both versions. A v1 file restores device keys only.
- An app from before v2 reads a v2 file as a wrong passphrase. It's only a confusing message, since such an app can't use the history anyway, but the release notes should mention it.

#### One key per person

The history key belongs to the person, not the phone, so their phones must agree on it.
- The server keeps a **key id** per person: SHA-256 of the history key. It reveals nothing about the key, and every upload names it.
- **Turning backup on** on a phone with no history key: if the server has no key id, the phone makes a key, registers its id, and saves the file. If the server already has one, another phone made it. The screen then asks the person to restore that file here, or to start over, which deletes the old history.
- **A second phone** gets the key by restoring the same file, as the screen already says for v1. Until it has the key, it uploads nothing, and the phone that has it covers only the chats it syncs. Sharing the key between a person's live phones automatically, for example through an MLS group of just their own phones, is possible later. It isn't needed for a first version.
- **A new passphrase** writes a new file with the same key. The old file still opens the history, so the screen should say that deleting the old file is the person's job.
- **Turning backup off** deletes the person's history on the server and the key id, and forgets the key on this phone. Turning it on again starts a new key and a new history.

#### Uploading

- **What each entry holds:** sender, sender's phone, text, server time, `seq`, the franking key, and `unverified`. Keeping the franking key lets a restored message still be reported, since the server keeps the MLS log.
- **How it's sealed:** XChaCha20-Poly1305 under the history key, with the user id, conversation id and `seq` as associated data. The server can't move an entry to another chat or position.
- **When:** the engine adds an entry to an outbox table in the phone's MLS database, in the same transaction that stores the message: each received message, and each sent one once it has its `seq`. A flush after each sync uploads the outbox in batches. So nothing is lost to a crash or to being offline.
- **Back-fill:** turning backup on queues everything the phone already holds.
- **Duplicates:** several of a person's phones upload the same message. The server keeps the first copy, keyed by person, chat and `seq`, and ignores the rest.

#### The server

- **A D1 table** `mls_history`: user id, conversation id, `seq`, key id, ciphertext, created time, with primary key (user, conversation, seq). D1 rather than each ChatRoom, so a restore can page through all of a person's chats in one place. A second table, `mls_history_keys`, holds each person's key id. Migration `0011` adds both.
- **Routes:**
  - `GET` and `POST /mls/history/key`, to read, set or clear the key id. Clearing it deletes the history. Setting a different key from the one in place is refused with 409 unless the request says `replace`, which deletes the old history.
  - `POST /mls/history`, at most 100 entries, each at most 16 KB sealed (`HISTORY_ENTRY_MAX_BYTES`, shared by the route's schema and the phone).
  - `GET /mls/history/:conversationId?after=`, 200 at a time, oldest first.
- **Checks:** the caller must be a current member of the chat, and the chat must be open. The `seq` must be an application entry in its log, and the key id must be the caller's current one. Entries that fail come back in `rejected`, and the phone stops trying them. Uploads take their own rate limit, `MLS_HISTORY_LIMIT`, 60 batches a minute per person.
- **Sizes:** a phone skips a message that seals to more than 16 KB, and drops a batch the server calls malformed. Any member can send a message that large, and one entry that can never be stored mustn't hold up everything queued behind it.
- **What it learns:** nothing new. It already knows who's in each chat and every entry's `seq`, time and size. A history entry also tells it that the person turned backup on.
- **Deleting:** leaving a group deletes the person's history for it, and a block deletes both people's history for the chat it closes. That matches each phone deleting its own copy (decided 2026-11-17). Account deletion deletes all of it.

#### Restoring on a new phone

1. Restore the file. This saves the v1 device keys as today, and the history key in SecureStore.
2. For each chat in the inbox, download that chat's history and write each entry into the MLS store as a sent message with `id = seq`. That's the id a live message gets, so whichever arrives second does nothing.
3. The phone joins each chat as it does today: from a Welcome, or by itself from the GroupInfo. Its cursor starts where it joined. History covers everything before, and the log covers everything after.

A restore can come before or after joining; both orders end the same. A message the history doesn't have, because no phone with the key read it, stays missing, as now.

#### On the screen

- **Saving** checks the key first and changes nothing. If another phone's key is in place, it asks whether to start over. It writes the file, and only then turns history on, so a save that fails leaves no history on the server without a file holding its key. Android's share sheet doesn't say whether the person cancelled, so a cancelled share still turns it on.
- **Restoring** takes the file's history key only if it's still the person's current one, then queues what the phone holds and fills in every chat in the inbox. An old file can't turn history back on after the person stopped it or replaced it; the screen says the file no longer brings back history.
- **At launch** the phone checks its stored key against the server's. If another phone started over, it forgets its key. If the check fails, it keeps queueing, and a refused upload stops it later.
- **Stopping** asks first, then deletes the server's copy and the phone's key.

#### Tests

- `rules.test.ts`: the v2 file carries the history key, and a v1 file still opens.
- `mlsHistory.test.ts`, on the memory server:
  - Sealing is bound to the person, chat and place in the log.
  - A phone uploads what it held, read and sent. A new phone restores it in order, with nothing twice and the franking keys kept.
  - One key per person, and starting over makes the old phone stop.
  - Offline uploads are kept and sent later, and stopping deletes the history.
  - An oversized message is skipped.
  - An old file can't turn history back on.
  - A launch that can't check its key keeps queueing.
  - The SQL store keeps the queue through a restart and forgets a chat's queue with the chat.
- `mls.e2e.ts`: the routes through the Worker: no upload without a key, one key per person, only messages in open chats the person is in, the first copy wins, an old key is refused, nobody reads anyone else's, starting over deletes, a block closes it, and turning off clears the key.
- Not tested: leaving a group deleting that person's history. The route does it in the same batch as removing the membership.
- On the emulator (2026-11-18), with `apps/api/scripts/mls-history-peer.ts` playing Alice's first phone and Bob. They moved a chat to MLS and traded three messages, and the first phone backed up its history and wrote Alice's backup file. The emulator, signed in as Alice's new phone, showed none of the three when it opened the chat.
  - After restoring the file on the backup screen, all three showed, in order, Alice's own on her side. Ping and pong followed, and the server's history went from 3 entries to 5, the new phone's uploads included.
  - "Stop backing up messages" left 0 history rows and 0 keys on the server.
  - Restoring the same file again said it no longer brings back history, and the server stayed at 0 and 0.

#### Decided

On 2026-11-18 the user approved the plan as written: opt-in, history deleted when the person leaves a chat, and franking keys kept in history so restored messages can be reported.

### Reports to moderators

Today the reporter hands over a message's `contentKey`. The server decrypts the stored envelope with it and confirms the text. MLS has no per-message key that the server could use like that.

Use **message franking** instead:

- The sender picks a random 32-byte franking key for each message, puts it inside the encrypted message with the text, and puts `HMAC-SHA256(frankingKey, conversationId ‖ senderId ‖ text)` in the MLS `authenticated_data`. That field travels in the clear and the AEAD binds it.
- The Durable Object stores that commitment with the message.
- Phones check the commitment against what they decrypted, and show the message as unverifiable if it doesn't match.
- A reporter sends the text and the franking key. The server recomputes the HMAC and compares it with what it stored from the sender's own socket.

Nothing else in the chat becomes readable, the same as today.

Built:
- `packages/shared/src/franking.ts` holds the format. Inside the encryption: a version byte, the 32-byte franking key, then the text. In the authenticated data: a version byte, then `HMAC-SHA256(key, "babillard-franking-v1" ‖ conversationId ‖ senderId ‖ text)`, each input with a 4-byte length in front.
- The engine franks every message it sends, with a new key each time. It keeps each message's key in the store, sealed like the text, including for its own messages.
- On receipt it checks the commitment. A message that doesn't match, or isn't franked, is kept and marked `unverified`, with no key. It's never refused: refusing it would leave the phone stuck on that entry, and let one member stop the chat for everyone. The chat shows such a message with "If reported, this message can't be confirmed" under it.
- The report screen sends the reported message and up to 9 on each side, each with its text and key. The server reads the commitment from the message as the sender's session submitted it, and uses its own record of who sent it, not the reporter's. Only matching messages become evidence, in the same list as v1 evidence, so the moderator's view is unchanged.
- The server's reader now returns a private message's authenticated data. The OpenMLS fixture's message, which carries the authenticated data `commitment`, checks that.
- Tests: `franking.test.ts` covers the format and both ends of the engine, including a phone that commits to different text than it sends. `mlsEngine.e2e.ts` reports a message through the real Worker and checks that the admin queue shows its text and not the words a reporter made up.

### Previews and push

Push stays "New message" with the sender's name. Inbox previews come from the local message store instead of decrypting `lastMessageEnvelope` again. The server stops storing an envelope for previews and keeps only who sent the last message and when.

## Moving existing chats over

Goal: nobody loses history they can read today.

- **v1 stays for reading, indefinitely.** `openMessage`, every device key in SecureStore, and v1 backups stay. Old envelopes stay in `messages` and open exactly as now. Nothing gets re-encrypted.
- **One chat at a time.** A chat moves to MLS when its first commit is accepted, and the server accepts it only once every current member has at least one phone registered for MLS with a key package waiting (the author excepted). The first phone to open the chat after that creates the group, as in "Groups forming". From then on the server refuses v1 in that chat.
- **History in the app.** The chat screen shows v1 messages and MLS ones in a single timeline, ordered by server time. The v1 security code shows until this phone is in the group, then the roster code takes over.

## Rolling it out

Built on the branch: the server's three modes (`MLS_ENABLED`), `/me`'s `mls` flag, and the app following that flag instead of a build-time one. The steps:

1. **Deploy the Worker with `MLS_ENABLED` still `"false"`.** Apply migration `0010` first (see "Before turning it on").
2. **Release the app with MLS dormant.** It's the normal release, with the native module and the engine in it. While `/me` says `mls: false` it never opens the MLS database or calls an MLS route, so it behaves as the current release does.
3. **Raise `ANDROID_MIN_VERSION` to that release** once most phones have it. Older builds then show the required-update screen. The app checks the minimum at launch and on coming back to the foreground, at most hourly, and `/app/version` is cached for 5 minutes. So wait a few hours, a day to be safe, before the next step.
4. **Set `MLS_ENABLED` to `"true"`.** Each phone registers when it next loads `/me` and opens the inbox or a chat. Each chat moves once all its members have registered.

This order matters because the readiness check counts members, not phones. A member with one MLS phone and one older build counts as ready. Once their chat moves, the older build can't read it, and its sends are refused with `mls_mode`, with no way to recover. With the minimum raised first, that build is already stuck on the update screen. A member's phone that registers after the switch joins by itself from the GroupInfo, but can't read what was sent before it joined until backup v2 exists.

**Rolling back.** Once any chat has moved, use `"paused"`, never `"false"`:
- `"paused"` keeps every MLS chat working, new phones included, and moves no others. Chats not yet moved stay on v1. Setting `"true"` again lets them move.
- `"false"` strands every chat that moved. The `ChatRoom` refuses v1 there because its stored mode is `mls`, whatever the flag says. Every `/mls` route answers 404. And the app, seeing `mls: false`, stops showing the chat's MLS messages and sends v1, which is refused. So `"false"` is safe only before the first chat moves.
- Sending a chat back to v1 isn't built on the server. The phone, though, follows `/me`: if it says `mls: false`, the app sends v1 even in a chat where this phone is in an MLS group. An honest server refuses that with `mls_mode`. A dishonest one could accept it, which is a downgrade (see "Open security questions").

Tested: `mlsDelivery.test.ts` checks the paused rule on its own. `mlsEngineFailures.test.ts` pauses the in-memory server after a chat moved: messages still go both ways, a new phone joins, another chat stays on v1 with no error, and it moves once unpaused. The end-to-end suite runs a third Worker with `MLS_ENABLED=paused`, where a chat's first commit gets 409 `not_ready` and the chat stays on v1, and checks that `/me` says `mls: true` there and `mls: false` on the Worker with MLS off.

Tried on the emulator (2026-11-17), with a local Worker and `apps/api/scripts/mls-peer.ts` playing Bob, who now also waits for `/me` to say MLS is on:
- **With `MLS_ENABLED=false`:** the phone signed in as Alice, opened the inbox and the chat twice, and sent "hello over v1" over the socket. The Worker logged no `/mls` request at all, and the phone had no MLS database, only the app's existing key-value store.
- **After restarting the same Worker with `"true"`:** Bob registered on his next look at `/me`. The phone, reopened, registered, uploaded key packages and joined the chat's group. "ping over MLS" reached Bob, his "pong" showed on the phone, and both showed the same security code. The v1 message stayed in the timeline above them.
- **A message was lost in the switch, now fixed.** Bob created the group the moment the phone registered its identity, about a second before its key packages went up. So his claim for the phone came back empty, and he said hello in a group of one. The phone then joined by itself at the next epoch, and couldn't read that hello. The fix: the readiness check now also wants a key package for every member but the author, so the creator can add everyone before it sends. `mlsEngineFailures.test.ts` reproduces the timing (it failed before the fix), `mlsDelivery.test.ts` checks the rule, and `mls.e2e.ts` checks it through the Worker. Tried again on the emulator the same way: Bob's 15 tries to start the group were refused while the phone hadn't registered. Once it had, with its key packages, the phone started the group and added Bob in the next commit, and Bob's "Hello from Bob", the first message after the move, showed on the phone. Ping and pong followed. In this run the phone happened to create the group, so it didn't hit the one-second window itself; the engine test covers that timing.
- **What's left of it.** The check is per member, not per phone. A member's second phone that has registered but has no packages up when the group starts joins by itself and misses what came before, as any phone that signs in later does until backup v2. Holding sends until every phone is added would close that, but an abandoned phone with no packages left would then stop its chats for good, since phones don't upload a last-resort package yet and a phone is retired only when its owner has more than five. Phones top up their packages when the app opens, and now also on a sync at most every 10 minutes, so a phone left open refills too. A failed refill doesn't stop the sync. `mlsEngineFailures.test.ts` drains a phone and checks it refills without a relaunch.

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

- The dev screen (`app/dev-mls.tsx`) and its demos are gone from the app, with the `EXPO_PUBLIC_MLS_PROTOTYPE` flag. Metro bundles every route and every `import()`, so they had pulled ts-mls into the app. The engine demos live on in `packages/shared/src/mlsEngineDemo.ts`, which the shared tests run on ts-mls. The commit before their removal can run them on a phone again.
- `apps/mobile/metro.config.js` no longer maps the modules ts-mls and `@hpke` import dynamically, and is the same as on main.
- ts-mls stays in `packages/shared`, under `@babillard/shared/mls`, as the Node test client for the end-to-end tests. The app never imports that path. The source map of an exported Android bundle lists 2,073 modules, none from ts-mls or `@hpke`.

### What they don't prove

- Two real devices through a real Durable Object. The server is built and tested end to end, but with ts-mls phones in Node, not the app's OpenMLS module. OpenMLS output is checked against the server's rules by replaying a recorded session, not live.
- Backup and migration. Those are designed above and not built.
- Performance on a real phone, or with 8 members.
- Anything on ARM. All four ABIs compile, but only the x86_64 library has run, on the emulator. Nothing has run on a real phone yet.

## What's left, and roughly how long

One developer who knows the codebase. Done on the branch since the first estimate: the server's header reader, the key package service, the delivery service, the readiness check, external commits with GroupInfo export, the phone's sync engine with its encrypted SQLite store, the chat screens on MLS, recovery from lost answers and stuck entries, hiding blocked people's MLS messages, a person's second phone, the roster security code on the chat info screen, deleting a chat's MLS copy once the person is out of it, limits on key package claims, franked reports, the server's switch for a staged rollout, with a pause, taking ts-mls out of the app, and backup v2 for MLS history.

| Work | Estimate |
|---|---|
| Android build in EAS: the Rust hook is written and tried locally; a first EAS build and fixes | 1 day |
| Server, still to do: a way for people to retire a lost phone | 1 day |
| Rust wrapper: last-resort key packages and per-chat state | 2 to 4 days |
| Migration: the release itself, and watching the switch in production | 1 to 2 days |
| End-to-end tests with two devices, and on a real phone | 4 to 5 days |
| **Total** | **9 to 13 working days, about 2 to 3 weeks** |

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
9. **Draining key packages.** A member can claim packages for any phone waiting to join, and a commit the server then refuses still uses them up. A hostile member could drain a newcomer's packages that way. The last-resort package keeps the phone addable. Claims are now limited in two ways:
   - **Per chat and phone, the real limit.** The ChatRoom records claims. One chat gets at most 3 fresh single-use packages for a phone in any 10 minutes, which covers a lost race or two. Past that, a claim gets the phone's last-resort package, which isn't used up, or nothing. The engine already treats nothing as "add them later". So a hostile member can use up at most 3 packages per 10 minutes, per chat they share with someone joining.
   - **Per person, a coarse limit.** A Workers rate limit (`MLS_CLAIM_LIMIT`, 30 a minute) answers 429 to anyone claiming across many chats at once.
   - **What's still open.** Phones don't upload a last-resort package yet (it's in the Rust wrapper row above). Until they do, a phone whose fresh packages are spoken for waits up to 10 minutes to be added.
10. **Downgrade to v1.** The app uses MLS only while `/me` says `mls: true`, so a server that says `false` gets v1 from a phone that's already in a chat's MLS group. v1 is still end-to-end encrypted, but it has no forward secrecy or post-compromise security. A guard is simple: once this phone holds a chat's group, never send v1 there, and say the chat can't be used instead. Not built yet.
11. **The roster is the server's word.** It follows the commits the server accepted, and phones keep their own roster from the same commits. If they ever disagree, a phone should stop and show the security code, not trust either side.

The D1 migrations on the branch are `0010` and `0011`. Main has moved on since the branch started, so renumber them before merging.
