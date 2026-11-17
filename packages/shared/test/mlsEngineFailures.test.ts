import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryMlsStore, MlsMessenger, type MlsTransport } from "../src/mlsClient";
import { MemoryMlsServer } from "../src/mlsMemoryServer";
import { tsMlsCrypto } from "../src/mls/adapter";
import { mlsCiphersuite } from "../src/mls/provider";

const random = (length: number) => webcrypto.getRandomValues(new Uint8Array(length));
const crypto = tsMlsCrypto(mlsCiphersuite(random));
const CHAT = "chat";

function world(members: string[]) {
  const server = new MemoryMlsServer();
  server.setMembers(CHAT, members);
  const phones = new Map<string, { messenger: MlsMessenger; store: MemoryMlsStore }>();
  const phone = (name: string, deviceId = `${name}-phone`, transport?: (base: MlsTransport) => MlsTransport) => {
    const store = new MemoryMlsStore();
    const base = server.transportFor(name, deviceId);
    const messenger = new MlsMessenger(crypto, transport ? transport(base) : base, store, { userId: name, deviceId });
    phones.set(deviceId, { messenger, store });
    return messenger;
  };
  return { server, phone };
}

const texts = async (messenger: MlsMessenger) => (await messenger.sync(CHAT)).map((m) => m.text);

describe("the sync engine when the group's history includes people who are gone", () => {
  it("lets a phone that was offline catch up past someone who joined and left", async () => {
    const { server, phone } = world(["alice", "bob"]);
    const [alice, bob] = [phone("alice"), phone("bob")];
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);

    // While Bob is offline, Dave joins, and then leaves.
    server.setMembers(CHAT, ["alice", "bob", "dave"]);
    const dave = phone("dave");
    await dave.ensureIdentity();
    await alice.sync(CHAT);
    await dave.sync(CHAT);
    server.setMembers(CHAT, ["alice", "bob"]);
    await alice.send(CHAT, "Dave's gone");

    // Bob's log now holds a commit adding a phone that's no longer in the directory.
    expect(await texts(bob)).toEqual(["Dave's gone"]);
  });

  it("joins from a Welcome issued before someone left", async () => {
    const { server, phone } = world(["alice", "carol", "dave"]);
    const [alice, carol, dave] = [phone("alice"), phone("carol"), phone("dave")];
    for (const p of [alice, carol, dave]) await p.ensureIdentity();
    await alice.sync(CHAT);
    await dave.sync(CHAT);
    // Dave leaves before Carol ever opens the chat. Her Welcome's tree still has him.
    server.setMembers(CHAT, ["alice", "carol"]);
    await alice.send(CHAT, "hello");
    expect(await texts(carol)).toEqual(["hello"]);
  });

  it("lets a new phone join by itself while a departed phone is still in the group", async () => {
    const { server, phone } = world(["alice", "bob"]);
    const [alice, bob] = [phone("alice"), phone("bob")];
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    // Alice leaves, and nobody has removed her phone yet.
    server.setMembers(CHAT, ["bob"]);
    const bobsNewPhone = phone("bob", "bob-phone-2");
    await bobsNewPhone.ensureIdentity();
    await bobsNewPhone.sync(CHAT);
    await bobsNewPhone.send(CHAT, "just me now");
    expect(await texts(bob)).toEqual(["just me now"]);
    const state = await server.transportFor("bob", "bob-phone").groupState(CHAT);
    expect(state.roster.map((entry) => entry.deviceId).sort()).toEqual(["bob-phone", "bob-phone-2"]);
  });
});

describe("the sync engine when the network fails", () => {
  it("can register later if registration failed the first time", async () => {
    const { phone } = world(["alice"]);
    let fail = true;
    const alice = phone("alice", "alice-phone", (base) => ({
      ...base,
      registerIdentity: async (...args) => {
        if (fail) throw new Error("network");
        return base.registerIdentity(...args);
      },
    }));
    await expect(alice.ensureIdentity()).rejects.toThrow("network");
    fail = false;
    await alice.ensureIdentity();
    await alice.sync(CHAT);
    expect(await alice.securityCode(CHAT)).toMatch(/^\d{5}/);
  });

  it("resends a message whose send failed, exactly once", async () => {
    const { phone } = world(["alice", "bob"]);
    let drop = false;
    const alice = phone("alice", "alice-phone", (base) => ({
      ...base,
      submit: async (...args) => {
        if (drop) {
          drop = false;
          throw new Error("network");
        }
        return base.submit(...args);
      },
    }));
    const bob = phone("bob");
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    drop = true;
    await expect(alice.send(CHAT, "are you there?")).rejects.toThrow("network");
    await alice.retryPending(CHAT);
    await alice.retryPending(CHAT);
    expect(await texts(bob)).toEqual(["are you there?"]);
  });

  it("copes with two phones doing the same chore at once", async () => {
    const { server, phone } = world(["alice", "bob"]);
    const [alice, bob] = [phone("alice"), phone("bob")];
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    server.setMembers(CHAT, ["alice", "bob", "carol"]);
    const carol = phone("carol");
    await carol.ensureIdentity();
    // Alice and Bob both try to add Carol at the same time.
    await Promise.all([alice.sync(CHAT), bob.sync(CHAT)]);
    await alice.send(CHAT, "welcome, Carol");
    expect(await texts(carol)).toEqual(["welcome, Carol"]);
  });

  it("looks again when another phone added someone first", async () => {
    const { server, phone } = world(["alice", "bob"]);
    // Bob's engine can be handed a stale view of the server, as if Alice's commit landed mid-sync.
    const staleViews: Awaited<ReturnType<MlsTransport["groupState"]>>[] = [];
    const alice = phone("alice");
    const bob = phone("bob", "bob-phone", (base) => ({ ...base, groupState: async (id) => staleViews.shift() ?? base.groupState(id) }));
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    server.setMembers(CHAT, ["alice", "bob", "carol"]);
    await phone("carol").ensureIdentity();
    const stale = await server.transportFor("bob", "bob-phone").groupState(CHAT);
    expect(stale.pendingAdds.map((device) => device.deviceId)).toEqual(["carol-phone"]);
    await alice.sync(CHAT);

    // Bob's chores see Carol as waiting, but she isn't any more, so his claim is refused. He looks again and carries on.
    staleViews.push(stale, stale);
    await bob.sync(CHAT);
    expect(staleViews).toEqual([]);
    await alice.send(CHAT, "hi Carol");
    expect(await texts(bob)).toEqual(["hi Carol"]);
  });
});
