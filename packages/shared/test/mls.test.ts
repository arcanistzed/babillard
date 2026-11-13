import { webcrypto } from "node:crypto";
import { getCiphersuiteFromName, getCiphersuiteImpl, nobleCryptoProvider, type CiphersuiteImpl } from "ts-mls";
import { afterEach, describe, expect, it, vi } from "vitest";
import { admit, MemoryDeliveryService } from "../src/mls/delivery";
import { DemoDirectory, DemoMember, runTwoMemberDemo } from "../src/mls/demo";
import { addDevices, createDevice, encodeKeyPackage, encryptText, joinFromWelcome, receive, removeUser, rosterCode, startGroup } from "../src/mls/group";
import { MLS_CIPHERSUITE, mlsCiphersuite } from "../src/mls/provider";

const random = (length: number) => webcrypto.getRandomValues(new Uint8Array(length));

/** Builds a chat whose first member started the group. Others join with `join`. */
async function chat(id: string, suites: Record<string, CiphersuiteImpl> = {}) {
  const directory = new DemoDirectory();
  const server = new MemoryDeliveryService(id);
  const members = new Map<string, DemoMember>();

  async function person(name: string) {
    const cs = suites[name] ?? mlsCiphersuite(random);
    const device = await createDevice(name, `${name}-phone`, cs);
    directory.register(device);
    const member = new DemoMember(device, directory.config(), cs);
    members.set(name, member);
    return member;
  }

  async function add(by: DemoMember, ...joiners: DemoMember[]) {
    await by.catchUp(server);
    const output = await addDevices(by.state!, joiners.map((joiner) => encodeKeyPackage(joiner.device)), by.cs);
    const result = server.submit(output.commit, { deviceIds: joiners.map((joiner) => joiner.device.deviceId), bytes: output.welcome! });
    if (!result.ok) throw new Error(result.error);
    by.state = output.state;
    by.sent.add(server.log.length);
    for (const joiner of joiners) {
      const welcome = server.welcomes.get(joiner.device.deviceId)!;
      joiner.state = await joinFromWelcome(welcome.bytes, joiner.device, joiner.cs, joiner.config);
      joiner.cursor = welcome.seq;
    }
  }

  return { directory, server, members, person, add };
}

describe("MLS on a phone without WebCrypto", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forms a two-person group and trades messages with only getRandomValues available", async () => {
    // Hermes has crypto.getRandomValues (from expo-crypto) and nothing else.
    vi.stubGlobal("crypto", { getRandomValues: (array: Uint8Array) => webcrypto.getRandomValues(array) });
    expect(globalThis.crypto.subtle).toBeUndefined();

    const result = await runTwoMemberDemo(random);
    expect(result.bobInbox).toEqual(["Hi Bob, see you Thursday?"]);
    expect(result.aliceInbox).toEqual(["Yes, at the library."]);
    expect(result.aliceCode).toBe(result.bobCode);
    expect(result.stateBytes).toBeGreaterThan(0);
  });

  it("still needs its own provider: ts-mls's noble one calls crypto.subtle", async () => {
    // If this starts passing, ts-mls has gone pure JavaScript and provider.ts can shrink.
    vi.stubGlobal("crypto", { getRandomValues: (array: Uint8Array) => webcrypto.getRandomValues(array) });
    const cs = await getCiphersuiteImpl(getCiphersuiteFromName(MLS_CIPHERSUITE), nobleCryptoProvider);
    // It fails at the first step: @hpke/core makes X25519 keys with crypto.subtle.generateKey.
    await expect(createDevice("alice", "a", cs)).rejects.toThrow(/generateKey/);
  });
});

describe("MLS group behaviour", () => {
  it("speaks the same protocol as ts-mls's WebCrypto provider, both ways", async () => {
    const webcryptoSuite = await getCiphersuiteImpl(getCiphersuiteFromName(MLS_CIPHERSUITE));
    const { server, person, add } = await chat("interop", { bob: webcryptoSuite });
    const [alice, bob, carol] = [await person("alice"), await person("bob"), await person("carol")];
    alice.state = await startGroup("interop", alice.device, alice.cs, alice.config);

    // Alice's HPKE seals Bob's Welcome. Then Bob's seals Carol's.
    await add(alice, bob);
    await add(bob, carol);
    await alice.send(server, "from the phone provider");
    await bob.send(server, "from the WebCrypto provider");
    for (const member of [alice, bob, carol]) await member.catchUp(server);
    expect(carol.inbox).toEqual(["from the phone provider", "from the WebCrypto provider"]);
    expect(alice.inbox).toEqual(["from the WebCrypto provider"]);
    expect(bob.inbox).toEqual(["from the phone provider"]);
  });

  it("opens each message once, so the app has to keep the text", async () => {
    const { server, person, add } = await chat("once");
    const [alice, bob] = [await person("alice"), await person("bob")];
    alice.state = await startGroup("once", alice.device, alice.cs, alice.config);
    await add(alice, bob);
    await alice.send(server, "only once");
    const entry = server.log.at(-1)!;

    const first = await receive(bob.state!, entry.bytes, bob.cs);
    expect(first.kind === "text" && first.text).toBe("only once");
    await expect(receive(first.state, entry.bytes, bob.cs)).rejects.toThrow();
  });

  it("shuts out someone who was removed", async () => {
    const { server, person, add } = await chat("leave");
    const [alice, bob, carol] = [await person("alice"), await person("bob"), await person("carol")];
    alice.state = await startGroup("leave", alice.device, alice.cs, alice.config);
    await add(alice, bob, carol);
    const carolsLastState = carol.state!;

    const removal = await removeUser(alice.state!, "carol", alice.cs);
    expect(server.submit(removal.commit).ok).toBe(true);
    alice.state = removal.state;
    alice.sent.add(server.log.length);
    await alice.send(server, "after Carol left");

    await bob.catchUp(server);
    expect(bob.inbox).toEqual(["after Carol left"]);

    // Carol's phone applies its own removal, as an honest phone would, and still can't open what follows.
    const [removalEntry, afterEntry] = server.log.slice(-2);
    const removed = await receive(carolsLastState, removalEntry!.bytes, carol.cs);
    expect(removed.kind).toBe("commit");
    await expect(receive(removed.state, afterEntry!.bytes, carol.cs)).rejects.toThrow();
    // A phone that skipped the removal is a whole epoch behind and can't open it either.
    await expect(receive(carolsLastState, afterEntry!.bytes, carol.cs)).rejects.toThrow();
  });

  it("checks credentials on every phone, not just the one that commits", async () => {
    const { server, person, add } = await chat("receivers");
    const [alice, bob, carol, dave] = [await person("alice"), await person("bob"), await person("carol"), await person("dave")];
    alice.state = await startGroup("receivers", alice.device, alice.cs, alice.config);
    await add(alice, bob);

    // Bob's list of devices is missing Carol, so a commit adding her must fail on his phone.
    const bobsView = new DemoDirectory();
    for (const member of [alice, bob]) bobsView.register(member.device);
    bob.state = { ...bob.state!, clientConfig: bobsView.config() };
    await add(alice, carol);
    await expect(bob.catchUp(server)).rejects.toThrow(/Could not validate credential/);

    // Dave's list is missing Bob, so he must refuse a Welcome into a group with Bob in it.
    const output = await addDevices(alice.state!, [encodeKeyPackage(dave.device)], alice.cs);
    const davesView = new DemoDirectory();
    for (const member of [alice, carol, dave]) davesView.register(member.device);
    await expect(joinFromWelcome(output.welcome!, dave.device, dave.cs, davesView.config())).rejects.toThrow(/Could not validate credential/);
  });

  it("lets only one commit per epoch in, and the loser catches up and retries", async () => {
    const { server, person, add } = await chat("race");
    const [alice, bob, carol, dave] = [await person("alice"), await person("bob"), await person("carol"), await person("dave")];
    alice.state = await startGroup("race", alice.device, alice.cs, alice.config);
    await add(alice, bob);

    // Both commit at epoch 1. Alice reaches the server first.
    const fromAlice = await addDevices(alice.state!, [encodeKeyPackage(carol.device)], alice.cs);
    const fromBob = await addDevices(bob.state!, [encodeKeyPackage(dave.device)], bob.cs);
    expect(server.submit(fromAlice.commit, { deviceIds: [carol.device.deviceId], bytes: fromAlice.welcome! })).toMatchObject({ ok: true });
    alice.state = fromAlice.state;
    alice.sent.add(server.log.length);
    expect(server.submit(fromBob.commit)).toMatchObject({ ok: false, error: "stale_epoch", epoch: 2 });

    await add(bob, dave);
    await alice.catchUp(server);
    expect(rosterCode(alice.state!)).toBe(rosterCode(bob.state!));
    expect(server.epoch).toBe(3);
  });

  it("refuses a phone the server's device list doesn't vouch for", async () => {
    const { directory, person } = await chat("forged");
    const alice = await person("alice");
    alice.state = await startGroup("forged", alice.device, alice.cs, alice.config);
    await person("bob");
    // Someone else's key, presented under Bob's name.
    const impostor = await createDevice("bob", "bob-phone", alice.cs);
    expect(directory.keys.get("bob/bob-phone")).toBeDefined();
    await expect(addDevices(alice.state, [encodeKeyPackage(impostor)], alice.cs)).rejects.toThrow(/Could not validate credential/);
  });

  it("keeps the security code steady across epochs and changes it when someone joins", async () => {
    const { server, person, add } = await chat("code");
    const [alice, bob, carol] = [await person("alice"), await person("bob"), await person("carol")];
    alice.state = await startGroup("code", alice.device, alice.cs, alice.config);
    await add(alice, bob);
    const before = rosterCode(alice.state!);

    // A commit with no proposals refreshes keys and moves the epoch on.
    const refresh = await addDevices(alice.state!, [], alice.cs);
    expect(server.submit(refresh.commit).ok).toBe(true);
    alice.state = refresh.state;
    alice.sent.add(server.log.length);
    expect(alice.state.groupContext.epoch).toBe(2n);
    expect(rosterCode(alice.state)).toBe(before);

    await add(alice, carol);
    await bob.catchUp(server);
    expect(rosterCode(bob.state!)).not.toBe(before);
    expect(rosterCode(bob.state!)).toBe(rosterCode(carol.state!));
  });
});

describe("delivery service ordering", () => {
  it("accepts only well-formed messages for this chat at the current epoch", async () => {
    const cs = mlsCiphersuite(random);
    const device = await createDevice("alice", "alice-phone", cs);
    const directory = new DemoDirectory();
    directory.register(device);
    const state = await startGroup("room", device, cs, directory.config());
    const { message } = await encryptText(state, "hi", cs);

    expect(admit("room", 0, new TextEncoder().encode("{\"v\":1}"))).toMatchObject({ ok: false, error: "not_mls" });
    expect(admit("another-room", 0, message)).toMatchObject({ ok: false, error: "wrong_group" });
    expect(admit("room", 1, message)).toMatchObject({ ok: false, error: "stale_epoch" });
    expect(admit("room", 0, message)).toMatchObject({ ok: true, nextEpoch: 0, frame: { kind: "application", epoch: 0 } });
  });
});
