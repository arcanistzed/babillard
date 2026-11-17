import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DemoDirectory } from "../src/mls/demo";
import { addDevices, createDevice, encodeKeyPackage, encryptText, removeUser, startGroup } from "../src/mls/group";
import { mlsCiphersuite } from "../src/mls/provider";
import { MlsWireError, isWelcome, parseIdentity, readFrame, readGroupInfo, readKeyPackage } from "../src/mlsWire";

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
    expect(readFrame(sent.message)).toEqual({ wireformat: "private", groupId: "room-1", epoch: 2, kind: "application", authenticatedData: new Uint8Array() });
  });

  it("refuses anything malformed", () => {
    expect(() => readFrame(new Uint8Array([0, 1, 0, 2]))).toThrow(MlsWireError);
    expect(() => readFrame(new TextEncoder().encode('{"v":1}'))).toThrow(MlsWireError);
    expect(() => readKeyPackage(new Uint8Array([0, 1, 0, 5, 0, 1]))).toThrow(MlsWireError);
    expect(parseIdentity("a/b/c")).toBeNull();
  });
});

/** A GroupInfo laid out as RFC 9420 section 12.4.3 has it, with the given GroupInfo extensions. Nothing is signed: the server doesn't check. */
function groupInfo(extensions: [number, Uint8Array][], trailing = new Uint8Array()): Uint8Array {
  const vec = (data: Uint8Array) => (data.length < 64 ? [data.length, ...data] : [0x40 | (data.length >> 8), data.length & 0xff, ...data]);
  const u16 = (n: number) => [n >> 8, n & 0xff];
  const encodedExtensions = extensions.flatMap(([type, data]) => [...u16(type), ...vec(data)]);
  return Uint8Array.from([
    ...u16(1), ...u16(4), // MLS 1.0, group_info
    ...u16(1), ...u16(3), ...vec(new TextEncoder().encode("room-1")), 0, 0, 0, 0, 0, 0, 0, 7, // version, suite 3, group, epoch 7
    ...vec(new Uint8Array(32)), ...vec(new Uint8Array(32)), ...vec(new Uint8Array()), // tree hash, transcript hash, context extensions
    ...vec(Uint8Array.from(encodedExtensions)),
    ...vec(new Uint8Array(32)), 0, 0, 0, 0, ...vec(new Uint8Array(64)), // confirmation tag, signer, signature
    ...trailing,
  ]);
}

describe("the server's GroupInfo check", () => {
  // Its first byte would read as a length of 31, so only the key-size check catches the bare form.
  const key = new Uint8Array(32).fill(0x1f);
  const prefixed = Uint8Array.from([32, ...key]);

  it("takes an external_pub that's a length-prefixed key, as RFC 9420 and OpenMLS have it", () => {
    expect(readGroupInfo(groupInfo([[4, prefixed]]))).toEqual({ groupId: "room-1", epoch: 7 });
    expect(readGroupInfo(groupInfo([[2, new Uint8Array(10)], [4, prefixed]]))).toEqual({ groupId: "room-1", epoch: 7 });
  });

  it("refuses a GroupInfo a new phone couldn't join from", () => {
    // The bare key, as ts-mls 1.6.4 wrote it before the patch in patches/.
    expect(() => readGroupInfo(groupInfo([[4, key]]))).toThrow("bad external_pub");
    expect(() => readGroupInfo(groupInfo([[2, new Uint8Array(10)]]))).toThrow("needs one external_pub");
    expect(() => readGroupInfo(groupInfo([[4, prefixed], [4, prefixed]]))).toThrow("needs one external_pub");
    expect(() => readGroupInfo(groupInfo([[4, prefixed]], Uint8Array.of(0)))).toThrow("trailing bytes");
  });
});
