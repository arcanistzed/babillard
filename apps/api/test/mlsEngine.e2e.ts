// The phone's sync engine (packages/shared/src/mlsClient.ts) against the real
// Worker. On the phone it runs on OpenMLS; here on ts-mls, through the same
// interface. Cities and topics are ones no other test uses, and physics topics
// on purpose: right swipes raise a topic for everyone, and a deck test expects
// a physics topic first.
import { MlsMessenger, SqlMlsStore, httpMlsTransport, type HttpCall, type SqlDb } from "@babillard/shared";
import { mlsCiphersuite, tsMlsCrypto } from "@babillard/shared/mls";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { Client, createPerson } from "../scripts/api-client.ts";

const BASE = "http://localhost:8799";
const crypto = tsMlsCrypto(mlsCiphersuite((length) => new Uint8Array(randomBytes(length))));

let counter = 0;
async function person(cityId: string): Promise<Client & { email: string }> {
  counter += 1;
  const email = `engine-${counter}-${Date.now()}@example.test`;
  return Object.assign(await createPerson(BASE, email, { displayName: `Engine ${counter}`, cityId }), { email });
}

const random = (length: number) => new Uint8Array(randomBytes(length));

/** Node's built-in SQLite behind the interface the phone gives expo-sqlite. */
function sqliteDb(): SqlDb {
  const database = new DatabaseSync(":memory:");
  const db: SqlDb = {
    exec: async (sql) => void database.exec(sql),
    run: async (sql, params) => void database.prepare(sql).run(...params),
    all: async <T>(sql: string, params: (string | number | null | Uint8Array)[]) => database.prepare(sql).all(...params) as T[],
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

/** A phone running the engine, with its own encrypted SQLite store, talking to the server as `client`. */
function phoneFor(client: Client) {
  const call: HttpCall = async (method, path, body) => {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${client.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const store = new SqlMlsStore(sqliteDb(), random(32), random);
  const messenger = new MlsMessenger(crypto, httpMlsTransport(call), store, { userId: client.id, deviceId: client.device.publicKey });
  return { client, store, messenger, texts: async (id: string) => (await messenger.sync(id)).map((m) => m.text) };
}

async function directChat(cityId: string, topicId: string) {
  const [a, b] = await Promise.all([person(cityId), person(cityId)]);
  await a.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
  await b.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
  await a.post(`/people/${b.id}/swipe`, { direction: "right" });
  const { conversationId } = await b.post(`/people/${a.id}/swipe`, { direction: "right" });
  return { a, b, conversationId: conversationId as string };
}

describe("the phone's MLS sync engine", () => {
  it("forms a group, delivers messages, and removes someone who left before the next message", async () => {
    const people = await Promise.all(Array.from({ length: 4 }, () => person("denver-co-us")));
    let groupId: string | null = null;
    for (const client of people) groupId = (await client.post("/deck/topics/physics-for-non-physicists/swipe", { direction: "right" })).groupConversationId ?? groupId;
    const id = groupId!;
    const phones = people.map(phoneFor);
    for (const p of phones) await p.messenger.ensureIdentity();
    const [first, second, third, leaver] = phones as [ReturnType<typeof phoneFor>, ReturnType<typeof phoneFor>, ReturnType<typeof phoneFor>, ReturnType<typeof phoneFor>];

    // The first phone to sync creates the group and adds everyone. The rest join from their Welcomes.
    expect(await first.texts(id)).toEqual([]);
    expect((await first.client.get(`/mls/conversations/${id}`)).roster).toHaveLength(4);
    await second.texts(id);

    await first.messenger.send(id, "Thursday at the library?");
    expect(await second.texts(id)).toEqual(["Thursday at the library?"]);
    expect(await third.texts(id)).toEqual(["Thursday at the library?"]);

    // Someone leaves. The next sender removes their phone before its message can go out.
    await leaver.client.post(`/conversations/${id}/leave`);
    await second.messenger.send(id, "Just us three then");
    const state = await first.client.get(`/mls/conversations/${id}`);
    expect(state.roster).toHaveLength(3);
    expect(state.pendingRemovals).toEqual([]);
    expect(await first.texts(id)).toEqual(["Just us three then"]);
    expect(await third.texts(id)).toEqual(["Just us three then"]);

    // Everyone's own copy of the group agrees.
    const codes = await Promise.all([first, second, third].map((p) => p.messenger.securityCode(id)));
    expect(new Set(codes).size).toBe(1);
    expect(codes[0]).toMatch(/^\d{5} \d{5} \d{5} \d{5}$/);

    // The store kept the text, in order, with the sender's own message marked sent.
    expect((await second.store.messages(id)).map((m) => [m.text, m.status])).toEqual([
      ["Thursday at the library?", "sent"],
      ["Just us three then", "sent"],
    ]);

    // Being added used up a key package. The next check tops it back up.
    expect((await second.client.get(`/mls/key-packages/${second.client.device.publicKey}`)).available).toBe(9);
    await second.messenger.ensureIdentity();
    expect((await second.client.get(`/mls/key-packages/${second.client.device.publicKey}`)).available).toBe(10);
  });

  it("waits for everyone, then lets a new phone join by itself", async () => {
    const { a, b, conversationId: id } = await directChat("austin-tx-us", "astrophysics-and-cosmology");
    const alice = phoneFor(a);
    const bob = phoneFor(b);

    // Bob can't do MLS yet, so Alice's sync leaves the chat on v1.
    await alice.messenger.ensureIdentity();
    expect(await alice.texts(id)).toEqual([]);
    expect((await a.get(`/mls/conversations/${id}`)).mode).toBe("v1");

    // Once Bob's phone can, his sync creates the group, and Alice's joins it.
    await bob.messenger.ensureIdentity();
    await bob.texts(id);
    expect((await a.get(`/mls/conversations/${id}`)).mode).toBe("mls");
    await alice.texts(id);
    await alice.messenger.send(id, "Hi Bob");
    expect(await bob.texts(id)).toEqual(["Hi Bob"]);

    // Bob signs in on a new phone. It joins on its own from the server's GroupInfo.
    const newPhone = phoneFor(await new Client(BASE).signIn(b.email));
    await newPhone.messenger.ensureIdentity();
    expect(await newPhone.texts(id)).toEqual([]);
    await alice.messenger.send(id, "Welcome back");
    expect(await newPhone.texts(id)).toEqual(["Welcome back"]);
    expect(await bob.texts(id)).toEqual(["Welcome back"]);
    expect(await newPhone.messenger.securityCode(id)).toBe(await alice.messenger.securityCode(id));
  });
});
