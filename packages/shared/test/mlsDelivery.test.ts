import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { toBase64 } from "../src/e2ee";
import { decide, pendingAdds, pendingRemovals, type Directory, type RosterEntry, type Submission } from "../src/mlsDelivery";
import { addDevices, clientConfig, createDevice, encodeKeyPackage, encryptText, joinExternally, removeUser, startGroup, type CommitOutput, type MlsDevice } from "../src/mls/group";
import { mlsCiphersuite } from "../src/mls/provider";

const random = (length: number) => webcrypto.getRandomValues(new Uint8Array(length));
const ROOM = "room-1";

function directoryOf(...devices: MlsDevice[]): Directory {
  const directory: Directory = new Map();
  for (const device of devices) {
    if (!directory.has(device.userId)) directory.set(device.userId, new Map());
    directory.get(device.userId)!.set(device.deviceId, toBase64(device.keyPackage.leafNode.signaturePublicKey));
  }
  return directory;
}

const who = (device: MlsDevice) => ({ userId: device.userId, deviceId: device.deviceId });

/** A submission of a commit with its Welcome and GroupInfo. Members default to everyone in the directory. */
function commitBy(sender: MlsDevice, output: CommitOutput, at: { epoch: number; roster: RosterEntry[]; directory: Directory; memberIds?: string[] }): Submission {
  return {
    conversationId: ROOM,
    epoch: at.epoch,
    roster: at.roster,
    directory: at.directory,
    memberIds: at.memberIds ?? [...at.directory.keys()],
    sender: who(sender),
    message: output.commit,
    groupInfo: output.groupInfo,
    ...(output.welcome ? { welcome: output.welcome } : {}),
  };
}

async function setUp() {
  const cs = mlsCiphersuite(random);
  const [alice, bob, carol, mallory] = await Promise.all(["alice", "bob", "carol", "mallory"].map((name) => createDevice(name, `${name}-phone`, cs)));
  // The phones' own checks trust everyone here, so these tests reach the server's checks.
  const config = clientConfig(() => true);
  const directory = directoryOf(alice!, bob!, carol!);
  return { cs, alice: alice!, bob: bob!, carol: carol!, mallory: mallory!, config, directory };
}

/** Alice starts the group, and it's accepted. Returns her state and the server's roster. */
async function started(setup: Awaited<ReturnType<typeof setUp>>) {
  const { cs, alice, config, directory } = setup;
  const start = await addDevices(await startGroup(ROOM, alice, cs, config), [], cs);
  const decision = decide(commitBy(alice, start, { epoch: 0, roster: [], directory }));
  if (!decision.ok || decision.kind !== "commit") throw new Error(JSON.stringify(decision));
  return { state: start.state, roster: decision.roster };
}

describe("the server's MLS delivery rules", () => {
  it("lets a creator start the group, add members, and send", async () => {
    const setup = await setUp();
    const { cs, alice, bob, config, directory } = setup;
    const start = await addDevices(await startGroup(ROOM, alice, cs, config), [], cs);
    const first = decide(commitBy(alice, start, { epoch: 0, roster: [], directory }));
    expect(first).toMatchObject({ ok: true, kind: "commit", nextEpoch: 1, roster: [{ leafIndex: 0, userId: "alice" }] });
    const roster = first.ok && first.kind === "commit" ? first.roster : [];

    // Another member can't claim someone else's creating commit.
    expect(decide(commitBy(bob, start, { epoch: 0, roster: [], directory }))).toMatchObject({ ok: false, error: "bad_credential" });

    const add = await addDevices(start.state, [encodeKeyPackage(bob)], cs);
    expect(decide({ ...commitBy(alice, add, { epoch: 1, roster, directory }), welcome: undefined })).toMatchObject({ ok: false, error: "welcome_required" });
    expect(decide({ ...commitBy(alice, add, { epoch: 1, roster, directory }), groupInfo: undefined })).toMatchObject({ ok: false, error: "group_info_required" });
    // A GroupInfo for the wrong epoch is refused too.
    expect(decide({ ...commitBy(alice, add, { epoch: 1, roster, directory }), groupInfo: start.groupInfo })).toMatchObject({ ok: false, error: "bad_group_info" });
    const added = decide(commitBy(alice, add, { epoch: 1, roster, directory }));
    expect(added).toMatchObject({ ok: true, nextEpoch: 2, added: [{ leafIndex: 1, userId: "bob" }] });
    // Bob can't submit Alice's commit as his own.
    expect(decide(commitBy(bob, add, { epoch: 1, roster, directory }))).toMatchObject({ ok: false, error: "wrong_sender" });

    const after = added.ok && added.kind === "commit" ? added.roster : [];
    const sent = await encryptText(add.state, "hello", cs);
    const message = { conversationId: ROOM, roster: after, directory, memberIds: [...directory.keys()], sender: who(alice), message: sent.message };
    expect(decide({ ...message, epoch: 2 })).toEqual({ ok: true, kind: "application", epoch: 2 });
    expect(decide({ ...message, epoch: 3 })).toMatchObject({ ok: false, error: "stale_epoch" });
    expect(decide({ ...message, epoch: 2, conversationId: "room-2" })).toMatchObject({ ok: false, error: "wrong_group" });
  });

  it("won't move a chat to MLS until every member has a phone that can follow", async () => {
    const { cs, alice, config, directory } = await setUp();
    const start = await addDevices(await startGroup(ROOM, alice, cs, config), [], cs);
    // Dana is in the chat but hasn't registered an MLS phone.
    expect(decide(commitBy(alice, start, { epoch: 0, roster: [], directory, memberIds: ["alice", "bob", "carol", "dana"] }))).toMatchObject({ ok: false, error: "not_ready" });
  });

  it("won't start the group until every other member has a phone with a key package", async () => {
    const { cs, alice, config, directory } = await setUp();
    const start = await addDevices(await startGroup(ROOM, alice, cs, config), [], cs);
    const commit = commitBy(alice, start, { epoch: 0, roster: [], directory });
    // Carol's phone has registered its signing key, but its key packages aren't up yet. Alice needs none.
    expect(decide({ ...commit, withKeyPackages: new Set(["bob"]) })).toMatchObject({ ok: false, error: "not_ready" });
    expect(decide({ ...commit, withKeyPackages: new Set(["bob", "carol"]) })).toMatchObject({ ok: true, kind: "commit" });
  });

  it("while paused, starts no group but lets one that exists carry on", async () => {
    const setup = await setUp();
    const { cs, alice, bob, config, directory } = setup;
    const start = await addDevices(await startGroup(ROOM, alice, cs, config), [], cs);
    expect(decide({ ...commitBy(alice, start, { epoch: 0, roster: [], directory }), newGroups: false })).toMatchObject({ ok: false, error: "not_ready" });

    const { state, roster } = await started(setup);
    const add = await addDevices(state, [encodeKeyPackage(bob)], cs);
    const added = decide({ ...commitBy(alice, add, { epoch: 1, roster, directory }), newGroups: false });
    expect(added).toMatchObject({ ok: true, kind: "commit", added: [{ userId: "bob" }] });
    const after = added.ok && added.kind === "commit" ? added.roster : [];
    const sent = await encryptText(add.state, "still here", cs);
    expect(decide({ conversationId: ROOM, epoch: 2, roster: after, directory, memberIds: [...directory.keys()], newGroups: false, sender: who(alice), message: sent.message })).toEqual({
      ok: true,
      kind: "application",
      epoch: 2,
    });
  });

  it("refuses adding a phone the directory doesn't list", async () => {
    const setup = await setUp();
    const { state, roster } = await started(setup);
    const add = await addDevices(state, [encodeKeyPackage(setup.mallory)], setup.cs);
    expect(decide(commitBy(setup.alice, add, { epoch: 1, roster, directory: setup.directory }))).toMatchObject({ ok: false, error: "add_not_allowed" });
  });

  it("refuses senders who aren't members, and phones that aren't registered", async () => {
    const { cs, alice, mallory, config, directory } = await setUp();
    const start = await addDevices(await startGroup(ROOM, alice, cs, config), [], cs);
    const at = { epoch: 0, roster: [], directory };
    expect(decide(commitBy(mallory, start, at))).toMatchObject({ ok: false, error: "not_a_member" });
    expect(decide({ ...commitBy(alice, start, at), sender: { userId: "alice", deviceId: "other" } })).toMatchObject({ ok: false, error: "unknown_device" });
    expect(decide({ ...commitBy(alice, start, at), message: new TextEncoder().encode('{"v":1}') })).toMatchObject({ ok: false, error: "not_mls" });
  });

  it("holds new messages until someone who left is removed, and allows no other removals", async () => {
    const { cs, alice, bob, carol, config, directory } = await setUp();
    let state = (await addDevices(await startGroup(ROOM, alice, cs, config), [], cs)).state;
    const add = await addDevices(state, [encodeKeyPackage(bob), encodeKeyPackage(carol)], cs);
    state = add.state;
    const roster: RosterEntry[] = [
      { leafIndex: 0, ...who(alice) },
      { leafIndex: 1, ...who(bob) },
      { leafIndex: 2, ...who(carol) },
    ];

    // Removing Carol while she's still a member is refused: members can't kick each other.
    const kick = await removeUser(state, "carol", cs);
    expect(decide(commitBy(alice, kick, { epoch: 2, roster, directory }))).toMatchObject({ ok: false, error: "removal_not_allowed" });

    // Carol leaves. Messages wait until someone commits her removal.
    const afterLeave = directoryOf(alice, bob);
    expect(pendingRemovals(roster, afterLeave)).toEqual([{ leafIndex: 2, ...who(carol) }]);
    const sent = await encryptText(state, "anyone there?", cs);
    expect(decide({ conversationId: ROOM, epoch: 2, roster, directory: afterLeave, memberIds: ["alice", "bob"], sender: who(alice), message: sent.message })).toMatchObject({
      ok: false,
      error: "pending_removal",
    });
    expect(decide(commitBy(alice, kick, { epoch: 2, roster, directory: afterLeave }))).toMatchObject({ ok: true, nextEpoch: 3, roster: [{ leafIndex: 0 }, { leafIndex: 1 }] });
  });

  it("lets a member's phone join by itself from the stored GroupInfo", async () => {
    const setup = await setUp();
    const { cs, alice, bob, mallory, config, directory } = setup;
    const { state, roster } = await started(setup);
    // Alice's first commit carried the GroupInfo the server stores. Bob joins from it with nobody else online.
    const latest = await addDevices(state, [], cs);
    const afterUpdate = decide(commitBy(alice, latest, { epoch: 1, roster, directory }));
    const rosterNow = afterUpdate.ok && afterUpdate.kind === "commit" ? afterUpdate.roster : [];

    const joined = await joinExternally(latest.groupInfo, bob, cs, config);
    expect(decide(commitBy(bob, joined, { epoch: 2, roster: rosterNow, directory }))).toMatchObject({ ok: true, nextEpoch: 3, roster: [{ leafIndex: 0 }, { leafIndex: 1, userId: "bob" }] });
    // Someone who isn't a member can't join this way, and neither can a phone that's already in the group.
    const outsider = await joinExternally(latest.groupInfo, mallory, cs, config);
    expect(decide(commitBy(mallory, outsider, { epoch: 2, roster: rosterNow, directory }))).toMatchObject({ ok: false, error: "not_a_member" });
    const twice = await joinExternally(latest.groupInfo, bob, cs, config);
    const withBob = [...rosterNow, { leafIndex: 1, ...who(bob) }];
    expect(decide(commitBy(bob, twice, { epoch: 2, roster: withBob, directory }))).toMatchObject({ ok: false, error: "already_in_group" });
  });

  it("lists phones still to be added", async () => {
    const { alice, bob, carol } = await setUp();
    expect(pendingAdds([{ leafIndex: 0, ...who(alice) }], directoryOf(alice, bob, carol))).toEqual([who(bob), who(carol)]);
  });
});
