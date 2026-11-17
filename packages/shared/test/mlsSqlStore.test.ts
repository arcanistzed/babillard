import { webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { MlsStoredMessage } from "../src/mlsClient";
import { SqlMlsStore, type SqlDb } from "../src/mlsSqlStore";

const random = (length: number) => webcrypto.getRandomValues(new Uint8Array(length));

/** Node's built-in SQLite behind the same interface the phone gives expo-sqlite. */
function nodeDb(database = new DatabaseSync(":memory:")): SqlDb & { raw: DatabaseSync } {
  const db: SqlDb & { raw: DatabaseSync } = {
    raw: database,
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

const message = (id: string, text: string, seq: number | null): MlsStoredMessage => ({
  conversationId: "chat-1",
  id,
  seq,
  senderId: "alice",
  senderDeviceId: "alice-phone",
  text,
  createdAt: 1000 + (seq ?? 99),
  status: seq === null ? "pending" : "sent",
  ...(seq === null ? { ciphertext: new Uint8Array([9, 9, 9]), clientId: "c1" } : {}),
});

describe("the phone's encrypted MLS store", () => {
  it("keeps the device, cursors and messages, in order", async () => {
    const store = new SqlMlsStore(nodeDb(), random(32), random);
    expect(await store.loadDevice()).toBeNull();
    const state = random(500);
    await store.apply({
      device: { userId: "alice", deviceId: "alice-phone", registered: true, state },
      cursors: { "chat-1": 7 },
      messages: [message("local-1", "still sending", null), message("5", "first", 5), message("7", "second", 7)],
    });
    expect(await store.loadDevice()).toEqual({ userId: "alice", deviceId: "alice-phone", registered: true, state });
    expect(await store.cursor("chat-1")).toBe(7);
    expect(await store.cursor("chat-2")).toBe(0);
    const stored = await store.messages("chat-1");
    expect(stored.map((m) => m.text)).toEqual(["first", "second", "still sending"]);
    expect(stored[2]).toMatchObject({ status: "pending", clientId: "c1", ciphertext: new Uint8Array([9, 9, 9]) });

    // A sent copy replaces the pending one.
    await store.apply({ messages: [message("8", "still sending", 8)], deleteMessages: [{ conversationId: "chat-1", id: "local-1" }] });
    expect((await store.messages("chat-1")).map((m) => [m.id, m.status])).toEqual([
      ["5", "sent"],
      ["7", "sent"],
      ["8", "sent"],
    ]);
  });

  it("stores no state or text in the clear", async () => {
    const db = nodeDb();
    const store = new SqlMlsStore(db, random(32), random);
    const state = new TextEncoder().encode("PRIVATE-KEY-MATERIAL");
    await store.apply({ device: { userId: "alice", deviceId: "alice-phone", registered: true, state }, messages: [message("1", "meet at the library", 1)] });
    const raw = new TextDecoder("latin1").decode(Buffer.concat(db.raw.prepare("SELECT state FROM mls_device").all().map((row) => Buffer.from(row.state as Uint8Array))));
    expect(raw).not.toContain("PRIVATE-KEY-MATERIAL");
    const text = db.raw.prepare("SELECT text FROM mls_messages").all().map((row) => Buffer.from(row.text as Uint8Array).toString("latin1"));
    expect(text.join("")).not.toContain("meet at the library");
  });

  it("can't be read with another key, and notices rows moved between messages", async () => {
    const db = nodeDb();
    const store = new SqlMlsStore(db, random(32), random);
    await store.apply({ device: { userId: "alice", deviceId: "alice-phone", registered: true, state: random(10) }, messages: [message("1", "one", 1), message("2", "two", 2)] });
    await expect(new SqlMlsStore(db, random(32), random).loadDevice()).rejects.toThrow();
    db.raw.exec("UPDATE mls_messages SET text = (SELECT text FROM mls_messages WHERE id = '1') WHERE id = '2'");
    await expect(store.messages("chat-1")).rejects.toThrow();
  });

  it("applies a change all or nothing", async () => {
    const db = nodeDb();
    const store = new SqlMlsStore(db, random(32), random);
    const before = random(10);
    await store.apply({ device: { userId: "alice", deviceId: "alice-phone", registered: true, state: before }, cursors: { "chat-1": 1 } });

    // The database fails partway through the next change, after the state is written.
    let writes = 0;
    const failing: SqlDb = {
      ...db,
      transaction: (task) =>
        db.transaction((tx) =>
          task({
            ...tx,
            run: async (sql, params) => {
              if (++writes === 2) throw new Error("disk full");
              await tx.run(sql, params);
            },
          }),
        ),
    };
    const broken = new SqlMlsStore(failing, (store as unknown as { key: Uint8Array }).key, random);
    await expect(broken.apply({ device: { userId: "alice", deviceId: "alice-phone", registered: true, state: random(10) }, cursors: { "chat-1": 2 } })).rejects.toThrow("disk full");
    expect((await store.loadDevice())!.state).toEqual(before);
    expect(await store.cursor("chat-1")).toBe(1);
  });
});
