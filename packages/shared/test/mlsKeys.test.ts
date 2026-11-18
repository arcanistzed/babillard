import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toBase64 } from "../src/e2ee";
import { KEYS_MAX_AGE_MS, MemoryMlsStore, MlsMessenger, type MlsChange, type MlsTransport } from "../src/mlsClient";
import { MemoryMlsServer } from "../src/mlsMemoryServer";
import { readKeyPackage } from "../src/mlsWire";
import { tsMlsCrypto } from "../src/mls/adapter";
import { addDevices, clientConfig, createDevice, startGroup } from "../src/mls/group";
import { mlsCiphersuite } from "../src/mls/provider";

/** Last-resort key packages, and each phone replacing its own keys once a week. */

const random = (length: number) => webcrypto.getRandomValues(new Uint8Array(length));
const cs = mlsCiphersuite(random);
const crypto = tsMlsCrypto(cs);
const CHAT = "chat";
const DAY = 24 * 60 * 60 * 1000;

/** A memory store that can lose its key-update times, like a database from before they were kept. */
class OldStore extends MemoryMlsStore {
  unknown = new Set<string>();
  override async keysUpdatedAt(conversationId: string) {
    return this.unknown.has(conversationId) ? null : super.keysUpdatedAt(conversationId);
  }
  override async apply(change: MlsChange) {
    for (const id of Object.keys(change.keysUpdated ?? {})) this.unknown.delete(id);
    return super.apply(change);
  }
}

function world(members: string[]) {
  const server = new MemoryMlsServer();
  server.setMembers(CHAT, members);
  const uploads: { deviceId: string; fresh: number; lastResort: boolean }[] = [];
  const phone = (name: string, transport?: (base: MlsTransport) => MlsTransport) => {
    const deviceId = `${name}-phone`;
    const store = new OldStore();
    let base = server.transportFor(name, deviceId);
    base = {
      ...base,
      uploadKeyPackages: async (id, keyPackages, lastResort) => {
        uploads.push({ deviceId: id, fresh: keyPackages.length, lastResort: lastResort !== undefined });
        return server.transportFor(name, deviceId).uploadKeyPackages(id, keyPackages, lastResort);
      },
    };
    const messenger = new MlsMessenger(crypto, transport ? transport(base) : base, store, { userId: name, deviceId });
    return Object.assign(messenger, { local: store, deviceId });
  };
  /** Commits in the chat's log, by phone. Read as Bob, who is in every chat here. */
  const commitsBy = async (deviceId: string, conversationId = CHAT) => {
    const log = await server.transportFor("bob", "bob-phone").log(conversationId, 0);
    return log.filter((entry) => entry.kind === "commit" && entry.deviceId === deviceId).length;
  };
  return { server, phone, uploads, commitsBy };
}

const texts = async (messenger: MlsMessenger, conversationId = CHAT) => (await messenger.sync(conversationId)).map((m) => m.text);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a phone's last-resort key package", () => {
  it("goes up with the first top-up, and is replaced only when it's gone or getting old", async () => {
    const { server, phone, uploads } = world(["alice"]);
    let serverLostIt = false;
    const alice = phone("alice", (base) => ({
      ...base,
      keyPackageStatus: async (id) => ({ ...(await base.keyPackageStatus(id)), ...(serverLostIt ? { lastResort: false } : {}) }),
    }));
    await alice.ensureIdentity();
    expect(uploads).toEqual([{ deviceId: "alice-phone", fresh: 10, lastResort: true }]);
    expect(await server.transportFor("alice", "alice-phone").keyPackageStatus("alice-phone")).toEqual({ available: 10, lastResort: true });

    // Later checks leave it be while the server has it.
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await alice.sync(CHAT);
    expect(uploads).toHaveLength(1);

    // Gone from the server: a new one goes up on its own, with no single-use packages.
    serverLostIt = true;
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await alice.sync(CHAT);
    serverLostIt = false;
    expect(uploads.at(-1)).toEqual({ deviceId: "alice-phone", fresh: 0, lastResort: true });

    // Four weeks on, it's replaced before OpenMLS's 84-day lifetime runs out.
    vi.setSystemTime(Date.now() + 27 * DAY);
    await alice.sync(CHAT);
    expect(uploads).toHaveLength(2);
    vi.setSystemTime(Date.now() + 2 * DAY);
    await alice.sync(CHAT);
    expect(uploads).toHaveLength(3);
    expect(uploads.at(-1)).toEqual({ deviceId: "alice-phone", fresh: 0, lastResort: true });
  });

  it("lets others add a phone whose single-use packages are gone, to more than one chat, and the phone then replaces its keys", async () => {
    const { server, phone, commitsBy } = world(["alice", "bob"]);
    server.setMembers("other", ["carol", "bob"]);
    const [alice, bob, carol] = [phone("alice"), phone("bob"), phone("carol")];
    await bob.ensureIdentity();
    // Someone claims every single-use package Bob's phone has.
    const claimer = server.transportFor("alice", "alice-phone");
    for (let i = 0; i < 10; i++) await claimer.claimKeyPackages(CHAT, ["bob-phone"]);
    expect(await server.transportFor("bob", "bob-phone").keyPackageStatus("bob-phone")).toEqual({ available: 0, lastResort: true });

    // Alice moves the chat to MLS and adds Bob's phone from the last-resort package.
    await alice.ensureIdentity();
    await alice.sync(CHAT);
    await alice.send(CHAT, "hi Bob");
    expect(await texts(bob)).toEqual(["hi Bob"]);
    // Its keys are shared with any other chat that package let it into, so the phone replaces them at once.
    expect(await commitsBy("bob-phone")).toBe(1);
    await bob.send(CHAT, "hi Alice");
    expect(await texts(alice)).toEqual(["hi Alice"]);
    expect(await alice.securityCode(CHAT)).toBe(await bob.securityCode(CHAT));

    // Carol adds the same phone to another chat, from the same package: its private key is still there.
    await carol.ensureIdentity();
    await carol.sync("other");
    await carol.send("other", "hi from Carol");
    expect(await texts(bob, "other")).toEqual(["hi from Carol"]);
    expect(await commitsBy("bob-phone", "other")).toBe(1);
    await bob.send("other", "hi Carol");
    expect(await texts(carol, "other")).toEqual(["hi Carol"]);
    expect(await server.transportFor("bob", "bob-phone").keyPackageStatus("bob-phone")).toEqual({ available: 0, lastResort: true });
  });

  it("is added from a single-use package while there is one, and then keeps its keys for a week", async () => {
    const { phone, commitsBy } = world(["alice", "bob"]);
    const [alice, bob] = [phone("alice"), phone("bob")];
    await bob.ensureIdentity();
    await alice.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    expect(await bob.inGroup(CHAT)).toBe(true);
    expect(await commitsBy("bob-phone")).toBe(0);
  });
});

describe("OpenMLS's last-resort key package", () => {
  // Written by the Rust test `last_resort_fixture` in apps/mobile/modules/babillard-mls.
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/openmls-last-resort.json", import.meta.url), "utf8")) as {
    userId: string;
    deviceId: string;
    signatureKey: string;
    keyPackage: string;
    createdAt: number;
  };
  const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));

  it("passes the server's checks, and ts-mls adds it", async () => {
    const parsed = readKeyPackage(bytes(fixture.keyPackage));
    expect(parsed.identity).toBe(`${fixture.userId}/${fixture.deviceId}`);
    expect(toBase64(parsed.signatureKey)).toBe(toBase64(bytes(fixture.signatureKey)));
    expect(parsed.cipherSuite).toBe(3);

    // Inside the package's lifetime, as when the phone made it.
    vi.setSystemTime(fixture.createdAt + 60 * 1000);
    const alice = await createDevice("alice", "alice-phone", cs);
    const group = await startGroup(CHAT, alice, cs, clientConfig(() => true));
    const output = await addDevices(group, [bytes(fixture.keyPackage)], cs);
    expect(output.welcome).toBeDefined();
  });
});

describe("each phone's own keys in a chat", () => {
  it("are replaced once a week by a phone that never commits otherwise", async () => {
    const { phone, commitsBy } = world(["alice", "bob"]);
    const [alice, bob] = [phone("alice"), phone("bob")];
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    expect(await commitsBy("bob-phone")).toBe(0);

    // Six days on, nothing yet.
    vi.setSystemTime(Date.now() + 6 * DAY);
    await bob.sync(CHAT);
    expect(await commitsBy("bob-phone")).toBe(0);

    // Past a week, Bob's phone commits new keys, once.
    vi.setSystemTime(Date.now() + DAY + 1000);
    await bob.sync(CHAT);
    await bob.sync(CHAT);
    expect(await commitsBy("bob-phone")).toBe(1);
    expect(await bob.local.keysUpdatedAt(CHAT)).toBe(Date.now());

    // Alice's phone made the group a week ago too, and catches up on Bob's commit before its own.
    const aliceCommits = await commitsBy("alice-phone");
    await alice.send(CHAT, "still here");
    expect(await commitsBy("alice-phone")).toBe(aliceCommits + 1);
    expect(await texts(bob)).toEqual(["still here"]);
    expect(await alice.securityCode(CHAT)).toBe(await bob.securityCode(CHAT));
  });

  it("start the clock in a chat with no time recorded, as after an upgrade, instead of committing at once", async () => {
    const { phone, commitsBy } = world(["alice", "bob"]);
    const [alice, bob] = [phone("alice"), phone("bob")];
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);

    vi.setSystemTime(Date.now() + 30 * DAY);
    bob.local.unknown.add(CHAT);
    await bob.sync(CHAT);
    expect(await commitsBy("bob-phone")).toBe(0);
    expect(await bob.local.keysUpdatedAt(CHAT)).toBe(Date.now());

    vi.setSystemTime(Date.now() + KEYS_MAX_AGE_MS);
    await bob.sync(CHAT);
    expect(await commitsBy("bob-phone")).toBe(1);
  });

  it("count a removal as a replacement, since it carries new keys", async () => {
    const { server, phone, commitsBy } = world(["alice", "bob", "carol"]);
    const [alice, bob, carol] = [phone("alice"), phone("bob"), phone("carol")];
    for (const p of [alice, bob, carol]) await p.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    await carol.sync(CHAT);

    vi.setSystemTime(Date.now() + 6 * DAY);
    server.setMembers(CHAT, ["alice", "bob"]);
    await bob.sync(CHAT);
    expect(await commitsBy("bob-phone")).toBe(1);

    // Two days later is eight days after joining, but only two after that removal.
    vi.setSystemTime(Date.now() + 2 * DAY);
    await bob.sync(CHAT);
    expect(await commitsBy("bob-phone")).toBe(1);
  });
});
