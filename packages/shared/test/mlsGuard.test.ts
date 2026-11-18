import { webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MemoryMlsStore, MlsMessenger } from "../src/mlsClient";
import { holdsMlsGroup, sendPath } from "../src/mlsGuard";
import { MemoryMlsServer } from "../src/mlsMemoryServer";
import { SqlMlsStore, type SqlDb } from "../src/mlsSqlStore";
import { tsMlsCrypto } from "../src/mls/adapter";
import { mlsCiphersuite } from "../src/mls/provider";

const random = (length: number) => webcrypto.getRandomValues(new Uint8Array(length));
const crypto = tsMlsCrypto(mlsCiphersuite(random));
const CHAT = "chat";
const OTHER = "other-chat";

function nodeDb(): SqlDb {
  const database = new DatabaseSync(":memory:");
  const db: SqlDb = {
    async exec(sql) {
      database.exec(sql);
    },
    async run(sql, params) {
      database.prepare(sql).run(...params);
    },
    async all<T>(sql: string, params: (string | number | null | Uint8Array)[]) {
      return database.prepare(sql).all(...params) as T[];
    },
    async transaction(task) {
      database.exec("BEGIN IMMEDIATE");
      try {
        await task(db);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return db;
}

describe("the downgrade guard", () => {
  it("knows from the store alone which chats this phone holds an MLS group for", async () => {
    const server = new MemoryMlsServer();
    server.setMembers(CHAT, ["alice", "bob"]);
    server.setMembers(OTHER, ["alice", "carol"]);
    const aliceStore = new SqlMlsStore(nodeDb(), random(32), random);
    const alice = new MlsMessenger(crypto, server.transportFor("alice", "alice-phone"), aliceStore, { userId: "alice", deviceId: "alice-phone" });
    const bob = new MlsMessenger(crypto, server.transportFor("bob", "bob-phone"), new MemoryMlsStore(), { userId: "bob", deviceId: "bob-phone" });

    // An empty store, before this phone ever had MLS, holds nothing.
    expect(await holdsMlsGroup(aliceStore, crypto, CHAT)).toBe(false);

    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    // Carol never registered, so the other chat stays on v1.
    await alice.sync(OTHER);
    // The same answer the engine gives, without the engine.
    expect(await alice.inGroup(CHAT)).toBe(true);
    expect(await alice.inGroup(OTHER)).toBe(false);

    expect(await holdsMlsGroup(aliceStore, crypto, CHAT)).toBe(true);
    expect(await holdsMlsGroup(aliceStore, crypto, OTHER)).toBe(false);

    // Checks that overlap, as a chat opening and a quick first send do, agree with each other.
    const together = await Promise.all([CHAT, OTHER, CHAT, OTHER, CHAT].map((chat) => holdsMlsGroup(aliceStore, crypto, chat)));
    expect(together).toEqual([true, false, true, false, true]);

    await alice.forgetChat(CHAT);
    expect(await holdsMlsGroup(aliceStore, crypto, CHAT)).toBe(false);
  });

  it("counts a commit still waiting for its answer, since it may have moved the chat", async () => {
    const store = new MemoryMlsStore();
    await store.apply({ pendingCommits: { [CHAT]: { epoch: 0, commit: new Uint8Array([1]), state: new Uint8Array([2]) } } });
    // No device and no group yet: only the commit in flight says the chat may have moved.
    expect(await holdsMlsGroup(store, crypto, CHAT)).toBe(true);
    expect(await holdsMlsGroup(store, crypto, OTHER)).toBe(false);
  });

  it("sends with MLS, sends v1, or refuses", () => {
    expect(sendPath(true, true)).toBe("mls");
    expect(sendPath(false, true)).toBe("refuse");
    expect(sendPath(true, false)).toBe("v1");
    expect(sendPath(false, false)).toBe("v1");
  });
});
