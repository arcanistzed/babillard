import { webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { toBase64 } from "../src/e2ee";
import { MemoryMlsStore, MlsMessenger, type MlsStore, type MlsTransport } from "../src/mlsClient";
import { historyKeyId, openHistoryEntry, sealHistoryEntry } from "../src/mlsHistory";
import { MemoryMlsServer } from "../src/mlsMemoryServer";
import { SqlMlsStore, type SqlDb } from "../src/mlsSqlStore";
import { tsMlsCrypto } from "../src/mls/adapter";
import { mlsCiphersuite } from "../src/mls/provider";

const random = (length: number) => webcrypto.getRandomValues(new Uint8Array(length));
const crypto = tsMlsCrypto(mlsCiphersuite(random));
const CHAT = "chat";

function world(members: string[]) {
  const server = new MemoryMlsServer();
  server.setMembers(CHAT, members);
  const phone = (name: string, deviceId = `${name}-phone`, options: { transport?: (base: MlsTransport) => MlsTransport; store?: MlsStore } = {}) => {
    const base = server.transportFor(name, deviceId);
    return new MlsMessenger(crypto, options.transport ? options.transport(base) : base, options.store ?? new MemoryMlsStore(), { userId: name, deviceId });
  };
  return { server, phone };
}

const texts = async (messenger: MlsMessenger, conversationId = CHAT) => (await messenger.messages(conversationId)).map((message) => message.text);

/** Node's SQLite behind the store's interface, as the SQL store's own tests do. */
function nodeSqlDb(db: DatabaseSync): SqlDb {
  const self: SqlDb = {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params) => {
      db.prepare(sql).run(...(params as never[]));
    },
    all: async <T>(sql: string, params: unknown[]) => db.prepare(sql).all(...(params as never[])) as T[],
    transaction: async (task) => {
      db.exec("BEGIN EXCLUSIVE");
      try {
        await task(self);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return self;
}

describe("history entries", () => {
  const key = random(32);
  const entry = { senderId: "bob", senderDeviceId: "bob-phone", text: "hello", createdAt: 1700000000000, frankingKey: random(32) };

  it("open only with the same key, for the same person, chat and place in the log", () => {
    const sealed = sealHistoryEntry(key, "alice", "c1", 7, entry, random);
    const opened = openHistoryEntry(key, "alice", "c1", 7, sealed);
    expect(opened?.text).toBe("hello");
    expect(opened?.frankingKey && toBase64(opened.frankingKey)).toBe(toBase64(entry.frankingKey));
    expect(openHistoryEntry(random(32), "alice", "c1", 7, sealed)).toBeNull();
    expect(openHistoryEntry(key, "bob", "c1", 7, sealed)).toBeNull();
    expect(openHistoryEntry(key, "alice", "c2", 7, sealed)).toBeNull();
    expect(openHistoryEntry(key, "alice", "c1", 8, sealed)).toBeNull();
    expect(new TextDecoder().decode(sealed)).not.toContain("hello");
  });

  it("name a key without revealing it", () => {
    expect(historyKeyId(key)).toBe(historyKeyId(new Uint8Array(key)));
    expect(historyKeyId(key)).not.toBe(historyKeyId(random(32)));
    expect(historyKeyId(key)).not.toContain(toBase64(key));
  });
});

describe("backup v2 in the sync engine", () => {
  it("uploads what a phone held before, what it reads and what it sends, and a new phone restores it", async () => {
    const { server, phone } = world(["alice", "bob"]);
    const [alice, bob] = [phone("alice"), phone("bob")];
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    await bob.send(CHAT, "before backup");
    await alice.sync(CHAT);

    const key = random(32);
    expect(await alice.enableHistory(key)).toBe("ok");
    expect(server.historyCount("alice")).toBe(1);
    await bob.send(CHAT, "read");
    await alice.sync(CHAT);
    await alice.send(CHAT, "sent");
    await bob.send(CHAT, "one more");
    await bob.send(CHAT, "and another");
    await alice.sync(CHAT);
    expect(server.historyCount("alice")).toBe(5);
    expect(server.historyCount("bob")).toBe(0);

    // Alice's new phone joins by itself, and can't read what came before it joined.
    const newPhone = phone("alice", "alice-phone-2");
    await newPhone.ensureIdentity();
    await newPhone.sync(CHAT);
    await bob.send(CHAT, "after the new phone");
    await newPhone.sync(CHAT);
    expect(await texts(newPhone)).toEqual(["after the new phone"]);

    // Restoring the file gives it the key, and history fills in the rest, in order, with nothing twice.
    expect(await newPhone.enableHistory(key)).toBe("ok");
    expect(await newPhone.restoreHistory(CHAT)).toBe(5);
    expect(await texts(newPhone)).toEqual(["before backup", "read", "sent", "one more", "and another", "after the new phone"]);
    expect(await newPhone.restoreHistory(CHAT)).toBe(0);
    // The restored messages keep their franking keys, so they can still be reported.
    expect((await newPhone.messages(CHAT)).every((message) => message.frankingKey)).toBe(true);
    // Both of Alice's phones uploaded the last message. The server kept one copy.
    await alice.sync(CHAT);
    expect(server.historyCount("alice")).toBe(6);
  });

  it("keeps one key per person: a second key is refused unless the person starts over", async () => {
    const { server, phone } = world(["alice", "bob"]);
    const [alice, bob] = [phone("alice"), phone("bob")];
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    const first = random(32);
    await alice.enableHistory(first);
    await bob.send(CHAT, "kept under the first key");
    await alice.sync(CHAT);
    expect(server.historyCount("alice")).toBe(1);

    const other = phone("alice", "alice-phone-2");
    await other.ensureIdentity();
    await other.sync(CHAT);
    const second = random(32);
    expect(await other.enableHistory(second)).toBe("exists");
    expect(other.historyActive()).toBe(false);
    expect(server.historyCount("alice")).toBe(1);

    // Starting over deletes the old history. The first phone finds out on its next upload and stops.
    expect(await other.enableHistory(second, true)).toBe("ok");
    await bob.send(CHAT, "after starting over");
    await alice.sync(CHAT);
    expect(alice.historyActive()).toBe(false);
    expect(await alice.useHistoryKey(first)).toBe(false);
    expect(await alice.useHistoryKey(second)).toBe(true);
  });

  it("keeps what it couldn't upload and sends it later, and turning backup off deletes the history", async () => {
    const { server, phone } = world(["alice", "bob"]);
    let online = true;
    const alice = phone("alice", "alice-phone", {
      transport: (base) => ({
        ...base,
        uploadHistory: async (...args) => {
          if (!online) throw new Error("offline");
          return base.uploadHistory(...args);
        },
      }),
    });
    const bob = phone("bob");
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    await alice.enableHistory(random(32));

    online = false;
    await bob.send(CHAT, "while offline");
    await expect(alice.sync(CHAT)).resolves.toHaveLength(1);
    expect(server.historyCount("alice")).toBe(0);
    online = true;
    await alice.sync(CHAT);
    expect(server.historyCount("alice")).toBe(1);

    await alice.disableHistory();
    expect(server.historyCount("alice")).toBe(0);
    await bob.send(CHAT, "not kept");
    await alice.sync(CHAT);
    expect(server.historyCount("alice")).toBe(0);
  });

  it("drops what the server won't keep, such as a chat the person has left", async () => {
    const { server, phone } = world(["alice", "bob", "carol"]);
    const [alice, bob, carol] = [phone("alice"), phone("bob"), phone("carol")];
    for (const p of [alice, bob, carol]) await p.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    await carol.sync(CHAT);
    await bob.send(CHAT, "hello");
    await alice.sync(CHAT);
    // Alice leaves before turning backup on, so the back-fill holds a chat she isn't in.
    server.setMembers(CHAT, ["bob", "carol"]);
    server.forgetHistory("alice", CHAT);
    expect(await alice.enableHistory(random(32))).toBe("ok");
    expect(server.historyCount("alice")).toBe(0);
    // Nothing is left waiting: a later sync of another chat uploads nothing more.
    server.setMembers("other", ["alice", "bob"]);
    await alice.sync("other");
    expect(server.historyCount("alice")).toBe(0);
  });

  it("keeps the queue in the SQL store through a restart, and forgets a chat's queue with the chat", async () => {
    const { server, phone } = world(["alice", "bob"]);
    const db = nodeSqlDb(new DatabaseSync(":memory:"));
    const storeKey = random(32);
    let online = false;
    const offline = (base: MlsTransport): MlsTransport => ({
      ...base,
      uploadHistory: async (...args) => {
        if (!online) throw new Error("offline");
        return base.uploadHistory(...args);
      },
    });
    const alice = phone("alice", "alice-phone", { transport: offline, store: new SqlMlsStore(db, storeKey, random) });
    const bob = phone("bob");
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    const key = random(32);
    await alice.enableHistory(key);
    await bob.send(CHAT, "queued");
    await alice.sync(CHAT);
    expect(await new SqlMlsStore(db, storeKey, random).historyOutbox(10)).toHaveLength(1);

    // The app restarts: a new engine over the same database, with the key from SecureStore.
    online = true;
    const restarted = phone("alice", "alice-phone", { transport: offline, store: new SqlMlsStore(db, storeKey, random) });
    expect(await restarted.useHistoryKey(key)).toBe(true);
    await restarted.sync(CHAT);
    expect(server.historyCount("alice")).toBe(1);

    online = false;
    await bob.send(CHAT, "queued again");
    await restarted.sync(CHAT);
    await restarted.forgetChat(CHAT);
    expect(await new SqlMlsStore(db, storeKey, random).historyOutbox(10)).toEqual([]);
  });
});
