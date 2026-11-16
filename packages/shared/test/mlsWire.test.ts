import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DemoDirectory } from "../src/mls/demo";
import { addDevices, createDevice, encodeKeyPackage, encryptText, removeUser, startGroup } from "../src/mls/group";
import { mlsCiphersuite } from "../src/mls/provider";
import { MlsWireError, isWelcome, parseIdentity, readFrame, readKeyPackage } from "../src/mlsWire";

const random = (length: number) => webcrypto.getRandomValues(new Uint8Array(length));

describe("the server's MLS reader, on real messages", () => {
  it("reads key packages, commits, welcomes and application messages", async () => {
    const cs = mlsCiphersuite(random);
    const [alice, bob, carol] = await Promise.all([createDevice("alice", "a1", cs), createDevice("bob", "b1", cs), createDevice("carol", "c1", cs)]);
    const directory = new DemoDirectory();
    for (const device of [alice, bob, carol]) directory.register(device);

    const kp = readKeyPackage(encodeKeyPackage(bob));
    expect(kp.identity).toBe("bob/b1");
    expect(kp.signatureKey).toEqual(bob.keyPackage.leafNode.signaturePublicKey);
    expect(parseIdentity(kp.identity)).toEqual({ userId: "bob", deviceId: "b1" });

    const state = await startGroup("room-1", alice, cs, directory.config());
    const added = await addDevices(state, [encodeKeyPackage(bob), encodeKeyPackage(carol)], cs);
    const frame = readFrame(added.commit);
    expect(frame).toMatchObject({ wireformat: "public", groupId: "room-1", epoch: 0, kind: "commit", sender: { type: "member", leafIndex: 0 } });
    expect(frame.wireformat === "public" && frame.commit?.adds.map((add) => add.identity)).toEqual(["bob/b1", "carol/c1"]);
    expect(isWelcome(added.welcome!)).toBe(true);
    expect(isWelcome(added.commit)).toBe(false);

    const removal = await removeUser(added.state, "carol", cs);
    const removed = readFrame(removal.commit);
    expect(removed.wireformat === "public" && removed.commit?.removes).toEqual([2]);
    expect(removed.epoch).toBe(1);

    const sent = await encryptText(removal.state, "hello", cs);
    expect(readFrame(sent.message)).toEqual({ wireformat: "private", groupId: "room-1", epoch: 2, kind: "application" });
  });

  it("refuses anything malformed", () => {
    expect(() => readFrame(new Uint8Array([0, 1, 0, 2]))).toThrow(MlsWireError);
    expect(() => readFrame(new TextEncoder().encode('{"v":1}'))).toThrow(MlsWireError);
    expect(() => readKeyPackage(new Uint8Array([0, 1, 0, 5, 0, 1]))).toThrow(MlsWireError);
    expect(parseIdentity("a/b/c")).toBeNull();
  });
});
