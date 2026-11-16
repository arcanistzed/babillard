import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { toBase64 } from "../src/e2ee";
import { decide, pendingAdds, pendingRemovals, type Directory, type RosterEntry } from "../src/mlsDelivery";
import { addDevices, clientConfig, createDevice, encodeKeyPackage, encryptText, removeUser, startGroup, type MlsDevice } from "../src/mls/group";
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

async function setUp() {
  const cs = mlsCiphersuite(random);
  const [alice, bob, carol, mallory] = await Promise.all(["alice", "bob", "carol", "mallory"].map((name) => createDevice(name, `${name}-phone`, cs)));
  // The phones' own checks trust everyone here, so these tests reach the server's checks.
  const config = clientConfig(() => true);
  const directory = directoryOf(alice!, bob!, carol!);
  return { cs, alice: alice!, bob: bob!, carol: carol!, mallory: mallory!, config, directory };
}

describe("the server's MLS delivery rules", () => {
  it("lets a creator start the group, add members, and send", async () => {
    const { cs, alice, bob, config, directory } = await setUp();
    let state = await startGroup(ROOM, alice, cs, config);

    // An empty commit carries an update path, which proves who's at leaf 0.
    const start = await addDevices(state, [], cs);
    const first = decide({ conversationId: ROOM, epoch: 0, roster: [], directory, sender: who(alice), message: start.commit });
    expect(first).toMatchObject({ ok: true, kind: "commit", nextEpoch: 1, roster: [{ leafIndex: 0, userId: "alice" }] });
    state = start.state;
    const roster = first.ok && first.kind === "commit" ? first.roster : [];

    // Another member can't claim someone else's creating commit.
    expect(decide({ conversationId: ROOM, epoch: 0, roster: [], directory, sender: who(bob), message: start.commit })).toMatchObject({ ok: false, error: "bad_credential" });

    const add = await addDevices(state, [encodeKeyPackage(bob)], cs);
    expect(decide({ conversationId: ROOM, epoch: 1, roster, directory, sender: who(alice), message: add.commit })).toMatchObject({ ok: false, error: "welcome_required" });
    const added = decide({ conversationId: ROOM, epoch: 1, roster, directory, sender: who(alice), message: add.commit, welcome: add.welcome! });
    expect(added).toMatchObject({ ok: true, nextEpoch: 2, added: [{ leafIndex: 1, userId: "bob" }] });
    // Bob can't submit Alice's commit as his own.
    expect(decide({ conversationId: ROOM, epoch: 1, roster, directory, sender: who(bob), message: add.commit, welcome: add.welcome! })).toMatchObject({ ok: false, error: "wrong_sender" });

    const after = added.ok && added.kind === "commit" ? added.roster : [];
    const sent = await encryptText(add.state, "hello", cs);
    expect(decide({ conversationId: ROOM, epoch: 2, roster: after, directory, sender: who(alice), message: sent.message })).toEqual({ ok: true, kind: "application", epoch: 2 });
    expect(decide({ conversationId: ROOM, epoch: 3, roster: after, directory, sender: who(alice), message: sent.message })).toMatchObject({ ok: false, error: "stale_epoch" });
    expect(decide({ conversationId: "room-2", epoch: 2, roster: after, directory, sender: who(alice), message: sent.message })).toMatchObject({ ok: false, error: "wrong_group" });
  });

  it("refuses adding a phone the directory doesn't list", async () => {
    const { cs, alice, mallory, config, directory } = await setUp();
    const state = await startGroup(ROOM, alice, cs, config);
    const start = await addDevices(state, [], cs);
    const roster: RosterEntry[] = [{ leafIndex: 0, ...who(alice) }];
    const add = await addDevices(start.state, [encodeKeyPackage(mallory)], cs);
    expect(decide({ conversationId: ROOM, epoch: 1, roster, directory, sender: who(alice), message: add.commit, welcome: add.welcome! })).toMatchObject({ ok: false, error: "add_not_allowed" });
  });

  it("refuses senders who aren't members, and phones that aren't registered", async () => {
    const { cs, alice, mallory, config, directory } = await setUp();
    const start = await addDevices(await startGroup(ROOM, alice, cs, config), [], cs);
    expect(decide({ conversationId: ROOM, epoch: 0, roster: [], directory, sender: who(mallory), message: start.commit })).toMatchObject({ ok: false, error: "not_a_member" });
    expect(decide({ conversationId: ROOM, epoch: 0, roster: [], directory, sender: { userId: "alice", deviceId: "other" }, message: start.commit })).toMatchObject({ ok: false, error: "unknown_device" });
    expect(decide({ conversationId: ROOM, epoch: 0, roster: [], directory, sender: who(alice), message: new TextEncoder().encode('{"v":1}') })).toMatchObject({ ok: false, error: "not_mls" });
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
    expect(decide({ conversationId: ROOM, epoch: 2, roster, directory, sender: who(alice), message: kick.commit })).toMatchObject({ ok: false, error: "removal_not_allowed" });

    // Carol leaves. Messages wait until someone commits her removal.
    const afterLeave = directoryOf(alice, bob);
    expect(pendingRemovals(roster, afterLeave)).toEqual([{ leafIndex: 2, ...who(carol) }]);
    const sent = await encryptText(state, "anyone there?", cs);
    expect(decide({ conversationId: ROOM, epoch: 2, roster, directory: afterLeave, sender: who(alice), message: sent.message })).toMatchObject({ ok: false, error: "pending_removal" });
    const removal = decide({ conversationId: ROOM, epoch: 2, roster, directory: afterLeave, sender: who(alice), message: kick.commit });
    expect(removal).toMatchObject({ ok: true, nextEpoch: 3, roster: [{ leafIndex: 0 }, { leafIndex: 1 }] });
  });

  it("lists phones still to be added", async () => {
    const { alice, bob, carol } = await setUp();
    expect(pendingAdds([{ leafIndex: 0, ...who(alice) }], directoryOf(alice, bob, carol))).toEqual([who(bob), who(carol)]);
  });
});
