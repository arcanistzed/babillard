// MLS_ENABLED="testers", through a real Worker: only the people in MLS_TESTERS hear MLS is on, and
// a chat moves only when every member is one. The Worker has its own database, so these topics
// don't change any other suite's deck. The phones are ts-mls clients in Node, as in mls.e2e.ts.
import { fromBase64, toBase64, type MlsGroupState, type MlsLogEntry } from "@babillard/shared";
import { addDevices, clientConfig, createDevice, encodeKeyPackage, encryptText, joinFromWelcome, mlsCiphersuite, receive, startGroup, type MlsDevice } from "@babillard/shared/mls";
import { randomBytes } from "node:crypto";
import type { ClientState } from "ts-mls";
import { describe, expect, it } from "vitest";
import { ApiError, Client, createPerson } from "../scripts/api-client.ts";
import { MLS_TESTER_EMAILS, TESTERS_PORT } from "./global-setup.ts";

const BASE = `http://localhost:${TESTERS_PORT}`;
const cs = mlsCiphersuite((length) => new Uint8Array(randomBytes(length)));

let testersUsed = 0;
let others = 0;
/** The next tester from MLS_TESTERS, or someone who isn't one. */
async function person(tester: boolean, cityId = "chicago-il-us"): Promise<Client> {
  const email = tester ? MLS_TESTER_EMAILS[testersUsed++] : `not-a-tester-${++others}-${Date.now()}@example.test`;
  if (!email) throw new Error("Out of tester emails: add more in global-setup.ts");
  return createPerson(BASE, email, { displayName: tester ? `Tester ${testersUsed}` : `Other ${others}`, cityId });
}

async function directChat(a: Client, b: Client, topicId: string): Promise<string> {
  await a.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
  await b.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
  await a.post(`/people/${b.id}/swipe`, { direction: "right" });
  const { conversationId } = await b.post(`/people/${a.id}/swipe`, { direction: "right" });
  expect(conversationId).toBeTruthy();
  return conversationId as string;
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

interface Phone {
  client: Client;
  device: MlsDevice;
  state: ClientState | null;
  cursor: number;
}

/** Registers a phone's MLS identity and uploads a key package, as the app does once `/me` says MLS is on. */
async function phone(client: Client): Promise<Phone> {
  const deviceId = client.device.publicKey;
  const device = await createDevice(client.id, deviceId, cs);
  await client.post("/mls/identity", { deviceId, signatureKey: toBase64(device.keyPackage.leafNode.signaturePublicKey) });
  await client.post("/mls/key-packages", { deviceId, keyPackages: [toBase64(encodeKeyPackage(device))] });
  return { client, device, state: null, cursor: 0 };
}

function trustFrom(state: MlsGroupState) {
  return clientConfig(({ userId, deviceId }, key) => state.directory.some((d) => d.userId === userId && d.deviceId === deviceId && d.signatureKey === toBase64(key)));
}

async function submit(p: Phone, conversationId: string, message: Uint8Array, extra: { welcome?: Uint8Array; groupInfo?: Uint8Array } = {}): Promise<MlsLogEntry> {
  return p.client.post(`/mls/conversations/${conversationId}/messages`, {
    deviceId: p.client.device.publicKey,
    message: toBase64(message),
    ...(extra.welcome ? { welcome: toBase64(extra.welcome) } : {}),
    ...(extra.groupInfo ? { groupInfo: toBase64(extra.groupInfo) } : {}),
  });
}

/** The first commit: an empty one from leaf 0, which is what moves the chat. */
async function startOnServer(p: Phone, conversationId: string): Promise<void> {
  const server: MlsGroupState = await p.client.get(`/mls/conversations/${conversationId}`);
  const created = await addDevices(await startGroup(conversationId, p.device, cs, trustFrom(server)), [], cs);
  const entry = await submit(p, conversationId, created.commit, { groupInfo: created.groupInfo });
  p.state = created.state;
  p.cursor = entry.seq;
}

async function addAll(p: Phone, conversationId: string, rest: Phone[]): Promise<void> {
  const claimed = await p.client.post(`/mls/conversations/${conversationId}/key-packages`, { deviceIds: rest.map((o) => o.client.device.publicKey) });
  expect(claimed.missing).toEqual([]);
  const added = await addDevices(p.state!, claimed.keyPackages.map((k: { keyPackage: string }) => fromBase64(k.keyPackage)), cs);
  const entry = await submit(p, conversationId, added.commit, { welcome: added.welcome!, groupInfo: added.groupInfo });
  p.state = added.state;
  p.cursor = entry.seq;
  for (const other of rest) {
    const server: MlsGroupState = await other.client.get(`/mls/conversations/${conversationId}`);
    const { seq, welcome } = await other.client.get(`/mls/conversations/${conversationId}/welcome/${other.client.device.publicKey}`);
    other.state = await joinFromWelcome(fromBase64(welcome), other.device, cs, trustFrom(server));
    other.cursor = seq;
  }
}

async function catchUp(p: Phone, conversationId: string): Promise<string[]> {
  const server: MlsGroupState = await p.client.get(`/mls/conversations/${conversationId}`);
  p.state = { ...p.state!, clientConfig: trustFrom(server) };
  const entries: MlsLogEntry[] = await p.client.get(`/mls/conversations/${conversationId}/messages?since=${p.cursor}`);
  const texts: string[] = [];
  for (const entry of entries) {
    p.cursor = entry.seq;
    if (entry.deviceId === p.client.device.publicKey) continue;
    const result = await receive(p.state!, fromBase64(entry.message), cs);
    p.state = result.state;
    if (result.kind === "text") texts.push(result.text);
  }
  return texts;
}

describe("MLS for named testers only", () => {
  it("tells testers MLS is on and everyone else that it's off", async () => {
    const [tester, other] = await Promise.all([person(true), person(false)]);
    expect((await tester.get("/me")).mls).toBe(true);
    expect((await other.get("/me")).mls).toBe(false);
  });

  it("moves a chat between two testers, and it keeps working", async () => {
    const [a, b] = await Promise.all([person(true), person(true)]);
    const conversationId = await directChat(a, b, "astrophysics-and-cosmology");
    const [alice, bob] = await Promise.all([phone(a), phone(b)]);
    await startOnServer(alice, conversationId);
    await addAll(alice, conversationId, [bob]);
    expect(await a.get(`/mls/conversations/${conversationId}`)).toMatchObject({ mode: "mls" });

    const hello = await encryptText(alice.state!, "hello, tester", cs);
    await submit(alice, conversationId, hello.message);
    alice.state = hello.state;
    expect(await catchUp(bob, conversationId)).toEqual(["hello, tester"]);
    // Moved, the chat refuses v1, as it does with MLS on for everyone.
    expect(await refusal(a.say(conversationId, "over v1"))).toMatchObject({ status: 403, body: { error: "mls_mode" } });
  });

  it("keeps a chat with someone who isn't a tester on v1, even if both phones registered", async () => {
    const [tester, other] = await Promise.all([person(true), person(false)]);
    const conversationId = await directChat(tester, other, "quantum-physics-without-the-hype");
    // Their app wouldn't register while /me says MLS is off. A phone from an earlier stage could have.
    const [testerPhone] = await Promise.all([phone(tester), phone(other)]);
    const refused = await refusal(startOnServer(testerPhone, conversationId));
    expect(refused).toBeInstanceOf(ApiError);
    // The engine reads not_ready as "wait", so the chat stays on v1 and v1 keeps working.
    expect(refused).toMatchObject({ status: 409, body: { error: "not_ready" } });
    expect(await tester.get(`/mls/conversations/${conversationId}`)).toMatchObject({ mode: "v1", roster: [] });
    await tester.say(conversationId, "still v1");
    expect((await other.read(conversationId)).map((message) => message.body)).toContain("still v1");
  });

  it("lets only a tester join an open group that moved", async () => {
    const people = await Promise.all(Array.from({ length: 4 }, () => person(true, "seattle-wa-us")));
    let groupId: string | null = null;
    for (const client of people) groupId = (await client.post("/deck/topics/climate-physics/swipe", { direction: "right" })).groupConversationId ?? groupId;
    expect(groupId).toBeTruthy();
    const id = groupId!;
    const phones = await Promise.all(people.map(phone));
    await startOnServer(phones[0]!, id);
    await addAll(phones[0]!, id, phones.slice(1));

    // Their app has MLS off and the group refuses v1, so they'd be stuck in it. They wait for another group instead.
    const outsider = await person(false, "seattle-wa-us");
    const joined = await outsider.post("/deck/topics/climate-physics/swipe", { direction: "right" });
    expect(joined.groupConversationId ?? null).not.toBe(id);
    expect(await refusal(outsider.get(`/conversations/${id}`))).toMatchObject({ status: 404 });

    const tester = await person(true, "seattle-wa-us");
    expect((await tester.post("/deck/topics/climate-physics/swipe", { direction: "right" })).groupConversationId).toBe(id);
  });
});
