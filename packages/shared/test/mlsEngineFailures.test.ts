import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decodeFrankedPayload } from "../src/franking";
import { MemoryMlsStore, MlsMessenger, MlsRemovedError, isOutOfChat, type MlsCrypto, type MlsTransport } from "../src/mlsClient";
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
  const stores = new Map<string, MemoryMlsStore>();
  const phone = (name: string, deviceId = `${name}-phone`, transport?: (base: MlsTransport) => MlsTransport, withCrypto: MlsCrypto = crypto) => {
    const store = new MemoryMlsStore();
    const base = server.transportFor(name, deviceId);
    const messenger = new MlsMessenger(withCrypto, transport ? transport(base) : base, store, { userId: name, deviceId });
    phones.set(deviceId, { messenger, store });
    stores.set(deviceId, store);
    return messenger;
  };
  return { server, phone, stores };
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

describe("what the chat screens ask the engine", () => {
  it("says whether this phone is in the group, and gives the latest message", async () => {
    const { phone } = world(["alice", "bob"]);
    const [alice, bob] = [phone("alice"), phone("bob")];
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    expect(await alice.inGroup(CHAT)).toBe(false);
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    expect(await alice.inGroup(CHAT)).toBe(true);
    expect(await bob.lastMessage(CHAT)).toBeNull();
    await alice.send(CHAT, "first");
    await alice.send(CHAT, "second");
    await bob.sync(CHAT);
    expect((await bob.lastMessage(CHAT))?.text).toBe("second");
    expect((await alice.messages(CHAT)).map((m) => [m.text, m.status])).toEqual([
      ["first", "sent"],
      ["second", "sent"],
    ]);
  });

  it("tells a retired phone it was removed", async () => {
    const { server, phone } = world(["alice", "bob"]);
    const [alice, bob] = [phone("alice"), phone("bob")];
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    server.retireDevice("bob-phone");
    await alice.send(CHAT, "bye, old phone");
    await expect(bob.sync(CHAT)).rejects.toBeInstanceOf(MlsRemovedError);
  });
});

describe("the sync engine when it doesn't know what happened", () => {
  /** A transport whose next submit of the given kind does or doesn't reach the server, but never answers. */
  function flaky(kind: "commit" | "application") {
    const control = { mode: "off" as "off" | "lands" | "lost" };
    const wrap = (base: MlsTransport): MlsTransport => ({
      ...base,
      submit: async (conversationId, body) => {
        const isCommit = body.groupInfo !== undefined;
        if (control.mode === "off" || isCommit !== (kind === "commit")) return base.submit(conversationId, body);
        const mode = control.mode;
        control.mode = "off";
        if (mode === "lands") await base.submit(conversationId, body);
        throw new Error("connection dropped");
      },
    });
    return { control, wrap };
  }

  async function groupOf(...names: string[]) {
    const made = world(names);
    return made;
  }

  it("adopts a commit that landed although its answer was lost", async () => {
    const { server, phone, stores } = await groupOf("alice", "bob");
    const net = flaky("commit");
    const alice = phone("alice", "alice-phone", net.wrap);
    const bob = phone("bob");
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);

    server.setMembers(CHAT, ["alice", "bob", "carol"]);
    const carol = phone("carol");
    await carol.ensureIdentity();
    // Alice adds Carol. The server takes the commit, but the answer never reaches Alice.
    net.control.mode = "lands";
    await expect(alice.sync(CHAT)).rejects.toThrow("connection dropped");
    expect(Object.keys(await stores.get("alice-phone")!.pendingCommits())).toEqual([CHAT]);

    // Her next operation finds the commit in the log and takes up the state it led to.
    await alice.send(CHAT, "hi Carol");
    expect(await stores.get("alice-phone")!.pendingCommits()).toEqual({});
    expect(await texts(carol)).toEqual(["hi Carol"]);
    expect(await texts(bob)).toEqual(["hi Carol"]);
    expect(await alice.securityCode(CHAT)).toBe(await carol.securityCode(CHAT));
  });

  it("drops a commit that never reached the server, and does the chore again", async () => {
    const { server, phone, stores } = await groupOf("alice", "bob");
    const net = flaky("commit");
    const alice = phone("alice", "alice-phone", net.wrap);
    const bob = phone("bob");
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);

    server.setMembers(CHAT, ["alice", "bob", "carol"]);
    const carol = phone("carol");
    await carol.ensureIdentity();
    net.control.mode = "lost";
    await expect(alice.sync(CHAT)).rejects.toThrow("connection dropped");
    // Bob adds Carol meanwhile, at the epoch Alice's lost commit was for.
    await bob.sync(CHAT);
    await alice.send(CHAT, "hello all");
    expect(await stores.get("alice-phone")!.pendingCommits()).toEqual({});
    expect(await texts(carol)).toEqual(["hello all"]);
    expect(await texts(bob)).toEqual(["hello all"]);
  });

  it("marks a message sent when it shows up in the log, without sending it twice", async () => {
    const { phone, stores } = await groupOf("alice", "bob");
    const net = flaky("application");
    const alice = phone("alice", "alice-phone", net.wrap);
    const bob = phone("bob");
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);

    net.control.mode = "lands";
    await expect(alice.send(CHAT, "did this go?")).rejects.toThrow("connection dropped");
    expect((await stores.get("alice-phone")!.messages(CHAT)).map((m) => m.status)).toEqual(["pending"]);
    await alice.sync(CHAT);
    expect((await stores.get("alice-phone")!.messages(CHAT)).map((m) => [m.text, m.status])).toEqual([["did this go?", "sent"]]);
    await alice.retryPending(CHAT);
    expect(await texts(bob)).toEqual(["did this go?"]);
  });

  it("rejoins by itself when an entry fails twice", async () => {
    const { server, phone } = await groupOf("alice", "bob");
    // Bob's phone can't apply one particular message, however often it tries.
    const brokenForBob: MlsCrypto = {
      ...crypto,
      receive: async (...args) => {
        const result = await crypto.receive(...args);
        if (result.kind === "application" && decodeFrankedPayload(result.plaintext)?.text === "garbled") throw new Error("can't apply");
        return result;
      },
    };
    const alice = phone("alice");
    const bob = phone("bob", "bob-phone", undefined, brokenForBob);
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);

    await alice.send(CHAT, "garbled");
    await expect(bob.sync(CHAT)).rejects.toThrow("can't apply");
    // The second failure on the same entry makes Bob's phone rejoin, replacing its old leaf.
    await bob.sync(CHAT);
    const state = await server.transportFor("bob", "bob-phone").groupState(CHAT);
    expect(state.roster.map((entry) => entry.deviceId).sort()).toEqual(["alice-phone", "bob-phone"]);

    await alice.send(CHAT, "can you read this?");
    expect(await texts(bob)).toEqual(["can you read this?"]);
    expect(await alice.securityCode(CHAT)).toBe(await bob.securityCode(CHAT));
  });
});

describe("the sync engine when someone is out of a chat", () => {
  const OTHER = "other-chat";

  /** Alice and Bob in two chats, both on MLS, each having read one message in each. */
  async function twoChats(bobTransport?: (base: MlsTransport) => MlsTransport) {
    const made = world(["alice", "bob"]);
    made.server.setMembers(OTHER, ["alice", "bob"]);
    const alice = made.phone("alice");
    const bob = made.phone("bob", "bob-phone", bobTransport);
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    for (const chat of [CHAT, OTHER]) {
      await alice.sync(chat);
      await alice.send(chat, `hello in ${chat}`);
      await bob.sync(chat);
    }
    return { ...made, alice, bob, bobStore: made.stores.get("bob-phone")! };
  }

  it("forgets a chat the person has left, and only that chat", async () => {
    const { server, bob, bobStore } = await twoChats();
    server.setMembers(CHAT, ["alice"]);
    await expect(bob.sync(CHAT)).rejects.toSatisfy(isOutOfChat);

    // Even given an empty list, as from a stale inbox, it checks each chat with the server first.
    expect(await bob.forgetChatsLeft([])).toEqual([CHAT]);
    expect(await bobStore.messages(CHAT)).toEqual([]);
    expect(await bobStore.cursor(CHAT)).toBe(0);
    expect(await bob.inGroup(CHAT)).toBe(false);
    expect((await bobStore.messages(OTHER)).map((m) => m.text)).toEqual([`hello in ${OTHER}`]);
    expect(await bob.inGroup(OTHER)).toBe(true);
    expect(await bobStore.conversationIds()).toEqual([OTHER]);
  });

  it("joins again when its phone is removed from the group while the person is still in the chat", async () => {
    const { server, alice, bob } = await twoChats();
    server.setMembers(CHAT, ["alice"]);
    await alice.send(CHAT, "just me");
    server.setMembers(CHAT, ["alice", "bob"]);

    // Bob's phone reads its own removal, drops its copy of the group, and joins again on the next sync.
    await expect(bob.sync(CHAT)).rejects.toBeInstanceOf(MlsRemovedError);
    expect(await bob.inGroup(CHAT)).toBe(false);
    await bob.sync(CHAT);
    expect(await bob.inGroup(CHAT)).toBe(true);
    await alice.send(CHAT, "welcome back");
    expect(await texts(bob)).toEqual(["welcome back"]);
    expect(await bob.securityCode(CHAT)).toBe(await alice.securityCode(CHAT));
  });

  it("doesn't let a commit in flight for a chat the person has left hold up the others", async () => {
    const control = { dropNextCommit: false };
    const { server, phone, alice, bob, bobStore } = await twoChats((base) => ({
      ...base,
      submit: async (conversationId, body) => {
        if (!control.dropNextCommit || body.groupInfo === undefined) return base.submit(conversationId, body);
        control.dropNextCommit = false;
        throw new Error("connection dropped");
      },
    }));
    // Bob's phone adds Carol's, and the answer to that commit never comes back.
    await phone("carol").ensureIdentity();
    server.setMembers(CHAT, ["alice", "bob", "carol"]);
    control.dropNextCommit = true;
    await expect(bob.sync(CHAT)).rejects.toThrow("connection dropped");
    expect(Object.keys(await bobStore.pendingCommits())).toEqual([CHAT]);

    // Bob leaves that chat before his phone finds out what happened to the commit.
    server.setMembers(CHAT, ["alice", "carol"]);
    await bob.send(OTHER, "still here");
    expect(await bobStore.pendingCommits()).toEqual({});
    expect((await alice.sync(OTHER)).map((m) => m.text)).toEqual(["still here"]);
  });
});

describe("the sync engine when a chat moves to MLS", () => {
  it("waits for the other phone's key packages, so the first message after the move reaches it", async () => {
    const { phone } = world(["alice", "bob"]);
    let uploads = false;
    const bob = phone("bob");
    const alice = phone("alice", "alice-phone", (base) => ({
      ...base,
      uploadKeyPackages: async (...args) => {
        if (!uploads) throw new Error("not up yet");
        return base.uploadKeyPackages(...args);
      },
    }));
    await bob.ensureIdentity();
    // Alice's phone has registered its signing key, but its key packages aren't up yet.
    await expect(alice.ensureIdentity()).rejects.toThrow("not up yet");
    await expect(bob.sync(CHAT)).resolves.toEqual([]);
    expect(await bob.inGroup(CHAT)).toBe(false);

    uploads = true;
    await alice.ensureIdentity();
    await bob.sync(CHAT);
    await bob.send(CHAT, "hello");
    expect(await texts(alice)).toEqual(["hello"]);
  });
});

describe("the sync engine's key packages", () => {
  it("refills them while the app stays open, at most every ten minutes, and a failed refill doesn't stop the sync", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { server, phone } = world(["alice", "bob"]);
      let uploads = true;
      const alice = phone("alice", "alice-phone", (base) => ({
        ...base,
        uploadKeyPackages: async (...args) => {
          if (!uploads) throw new Error("offline");
          return base.uploadKeyPackages(...args);
        },
      }));
      const count = async () => (await server.transportFor("alice", "alice-phone").keyPackageStatus("alice-phone")).available;
      await alice.ensureIdentity();
      expect(await count()).toBe(10);

      // Bob's phone claims every one of them, as adding Alice to chats would.
      const bob = server.transportFor("bob", "bob-phone");
      for (let i = 0; i < 10; i++) await bob.claimKeyPackages(CHAT, ["alice-phone"]);
      expect(await count()).toBe(0);

      // Soon after launch the phone doesn't check again.
      await alice.sync(CHAT);
      expect(await count()).toBe(0);

      // Later, a refill that fails leaves the sync working, and the next check refills.
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      uploads = false;
      await expect(alice.sync(CHAT)).resolves.toEqual([]);
      expect(await count()).toBe(0);
      uploads = true;
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      await alice.sync(CHAT);
      expect(await count()).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the sync engine while MLS is paused", () => {
  it("keeps a chat already on MLS going, adds new phones, and leaves other chats on v1", async () => {
    const { server, phone } = world(["alice", "bob"]);
    server.setMembers("unstarted", ["alice", "bob"]);
    const [alice, bob] = [phone("alice"), phone("bob")];
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);

    server.newGroups = false;
    await alice.send(CHAT, "paused but working");
    expect(await texts(bob)).toEqual(["paused but working"]);
    // A phone signing in now still joins the chat that's on MLS.
    const bobsNewPhone = phone("bob", "bob-phone-2");
    await bobsNewPhone.ensureIdentity();
    await bobsNewPhone.sync(CHAT);
    await bobsNewPhone.send(CHAT, "new phone");
    expect(await texts(alice)).toEqual(["new phone"]);

    // The other chat never had a group. Syncing it waits quietly, and it stays on v1.
    await expect(alice.sync("unstarted")).resolves.toEqual([]);
    expect(await alice.inGroup("unstarted")).toBe(false);
    expect((await server.transportFor("alice", "alice-phone").groupState("unstarted")).mode).toBe("v1");

    // Unpaused, it moves on the next sync.
    server.newGroups = true;
    await alice.sync("unstarted");
    expect(await alice.inGroup("unstarted")).toBe(true);
  });
});
