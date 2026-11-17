// MLS through the real Worker and ChatRoom Durable Object. The topics are physics
// ones on purpose: right swipes raise a topic for everyone, and the deck test
// expects a physics topic first. The phones here are
// ts-mls clients in Node: the wire format is standard MLS, so the server can't
// tell them from the app's OpenMLS module.
import { fromBase64, toBase64, type MlsGroupState, type MlsLogEntry } from "@babillard/shared";
import { addDevices, anotherKeyPackage, clientConfig, createDevice, encodeKeyPackage, encryptText, joinExternally, joinFromWelcome, receive, removeUser, startGroup, type MlsDevice } from "@babillard/shared/mls";
import { mlsCiphersuite } from "@babillard/shared/mls";
import { randomBytes } from "node:crypto";
import type { ClientState } from "ts-mls";
import { describe, expect, it } from "vitest";
import { ApiError, Client, createPerson } from "../scripts/api-client.ts";

const BASE = "http://localhost:8799";
const PROD = "http://localhost:8798";
const cs = mlsCiphersuite((length) => new Uint8Array(randomBytes(length)));

let counter = 0;
async function person(cityId: string): Promise<Client & { email: string }> {
  counter += 1;
  const email = `mls-${counter}-${Date.now()}@example.test`;
  return Object.assign(await createPerson(BASE, email, { displayName: `MLS ${counter}`, cityId }), { email });
}

/** Two people who match on a topic, and their direct chat. */
async function directChat(topicId: string) {
  const [a, b] = await Promise.all([person("chicago-il-us"), person("chicago-il-us")]);
  await a.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
  await b.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
  await a.post(`/people/${b.id}/swipe`, { direction: "right" });
  const { conversationId } = await b.post(`/people/${a.id}/swipe`, { direction: "right" });
  expect(conversationId).toBeTruthy();
  return { a, b, conversationId: conversationId as string };
}

async function status(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (error) {
    if (error instanceof ApiError) return error.status;
    throw error;
  }
}

/** A phone: its account, its MLS identity registered with the server, and one key package uploaded. */
interface Phone {
  client: Client;
  device: MlsDevice;
  state: ClientState | null;
  cursor: number;
}

async function phone(client: Client): Promise<Phone> {
  const deviceId = client.device.publicKey;
  const device = await createDevice(client.id, deviceId, cs);
  await client.post("/mls/identity", { deviceId, signatureKey: toBase64(device.keyPackage.leafNode.signaturePublicKey) });
  await client.post("/mls/key-packages", { deviceId, keyPackages: [toBase64(encodeKeyPackage(device))] });
  return { client, device, state: null, cursor: 0 };
}

/** The phone's own credential check, fed from the server's directory, as the app would do it. */
function trustFrom(state: MlsGroupState) {
  return clientConfig(({ userId, deviceId }, key) => state.directory.some((d) => d.userId === userId && d.deviceId === deviceId && d.signatureKey === toBase64(key)));
}

async function submit(p: Phone, conversationId: string, message: Uint8Array, extra: { welcome?: Uint8Array; groupInfo?: Uint8Array; clientId?: string } = {}): Promise<MlsLogEntry> {
  return p.client.post(`/mls/conversations/${conversationId}/messages`, {
    deviceId: p.client.device.publicKey,
    message: toBase64(message),
    ...(extra.welcome ? { welcome: toBase64(extra.welcome) } : {}),
    ...(extra.groupInfo ? { groupInfo: toBase64(extra.groupInfo) } : {}),
    ...(extra.clientId ? { clientId: extra.clientId } : {}),
  });
}

/** Applies everything new in the log, skipping the phone's own entries. Returns the texts it read. */
async function catchUp(p: Phone, conversationId: string): Promise<string[]> {
  // The directory changes as people add phones, so check credentials against the latest one.
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

/** Starts the group on the server. The first commit must carry an update path, so it's an empty commit. */
async function startOnServer(p: Phone, conversationId: string): Promise<void> {
  const server: MlsGroupState = await p.client.get(`/mls/conversations/${conversationId}`);
  const created = await addDevices(await startGroup(conversationId, p.device, cs, trustFrom(server)), [], cs);
  const entry = await submit(p, conversationId, created.commit, { groupInfo: created.groupInfo });
  p.state = created.state;
  p.cursor = entry.seq;
}

async function addAll(p: Phone, conversationId: string, others: Phone[]): Promise<void> {
  const claimed = await p.client.post(`/mls/conversations/${conversationId}/key-packages`, { deviceIds: others.map((o) => o.client.device.publicKey) });
  expect(claimed.missing).toEqual([]);
  const added = await addDevices(p.state!, claimed.keyPackages.map((k: { keyPackage: string }) => fromBase64(k.keyPackage)), cs);
  const entry = await submit(p, conversationId, added.commit, { welcome: added.welcome!, groupInfo: added.groupInfo });
  p.state = added.state;
  p.cursor = entry.seq;
  for (const other of others) {
    const server: MlsGroupState = await other.client.get(`/mls/conversations/${conversationId}`);
    const { seq, welcome } = await other.client.get(`/mls/conversations/${conversationId}/welcome/${other.client.device.publicKey}`);
    other.state = await joinFromWelcome(fromBase64(welcome), other.device, cs, trustFrom(server));
    other.cursor = seq;
  }
}

describe("MLS delivery service", () => {
  it("is off unless MLS_ENABLED is set", async () => {
    expect(await status(new Client(PROD).get("/mls/conversations/anything"))).toBe(404);
  });

  it("checks key packages, orders a two-person chat, and moves it off v1", async () => {
    const { a, b, conversationId } = await directChat("astrophysics-and-cosmology");

    const [alice, bob] = await Promise.all([phone(a), phone(b)]);
    // A key package must be the uploading phone's own, with its registered key.
    expect(await status(a.post("/mls/key-packages", { deviceId: a.device.publicKey, keyPackages: [toBase64(encodeKeyPackage(bob.device))] }))).toBe(400);
    // The signing key is set once.
    expect(await status(a.post("/mls/identity", { deviceId: a.device.publicKey, signatureKey: toBase64(bob.device.keyPackage.leafNode.signaturePublicKey) }))).toBe(409);

    const before: MlsGroupState = await a.get(`/mls/conversations/${conversationId}`);
    expect(before).toMatchObject({ mode: "v1", epoch: 0, roster: [] });
    expect(before.pendingAdds).toHaveLength(2);

    await startOnServer(alice, conversationId);
    // Only phones waiting to join can have packages claimed for them. Alice's is already in the group.
    expect(await status(b.post(`/mls/conversations/${conversationId}/key-packages`, { deviceIds: [a.device.publicKey] }))).toBe(403);
    await addAll(alice, conversationId, [bob]);
    // Claiming used up Bob's only package, and now he's in the group, so no one can claim for him.
    expect(await b.get(`/mls/key-packages/${b.device.publicKey}`)).toEqual({ available: 0, lastResort: false });
    expect(await status(a.post(`/mls/conversations/${conversationId}/key-packages`, { deviceIds: [b.device.publicKey] }))).toBe(403);

    const hello = await encryptText(alice.state!, "Hi Bob", cs);
    const sent = await submit(alice, conversationId, hello.message, { clientId: "first" });
    alice.state = hello.state;
    // Resending the same clientId returns the same entry instead of a second copy.
    expect((await submit(alice, conversationId, hello.message, { clientId: "first" })).seq).toBe(sent.seq);
    expect(await catchUp(bob, conversationId)).toEqual(["Hi Bob"]);

    const reply = await encryptText(bob.state!, "Hi Alice", cs);
    await submit(bob, conversationId, reply.message);
    bob.state = reply.state;
    expect(await catchUp(alice, conversationId)).toEqual(["Hi Alice"]);

    // A message from an old epoch is refused with a reason the phone can act on.
    const stale = await encryptText((await startGroup(conversationId, alice.device, cs, clientConfig(() => true))), "late", cs);
    expect(await status(submit(alice, conversationId, stale.message))).toBe(409);

    const after: MlsGroupState = await a.get(`/mls/conversations/${conversationId}`);
    expect(after).toMatchObject({ mode: "mls", epoch: 2, pendingAdds: [], pendingRemovals: [] });
    expect(after.roster.map((entry) => entry.userId)).toEqual([a.id, b.id]);
    // v1 envelopes are refused once the chat is on MLS.
    expect(await status(a.post(`/conversations/${conversationId}/messages`, { envelope: { v: 1, from: a.device.publicKey, nonce: "AA", ciphertext: "AA", keys: {} } }))).toBe(403);
  });

  it("holds messages after someone leaves a group until their phone is removed", async () => {
    const people = await Promise.all(Array.from({ length: 4 }, () => person("seattle-wa-us")));
    let groupId: string | null = null;
    for (const client of people) groupId = (await client.post("/deck/topics/climate-physics/swipe", { direction: "right" })).groupConversationId ?? groupId;
    expect(groupId).toBeTruthy();
    const id = groupId!;

    const phones = await Promise.all(people.map(phone));
    const [first, second, , leaver] = phones as [Phone, Phone, Phone, Phone];
    await startOnServer(first, id);
    await addAll(first, id, phones.slice(1));

    await leaver.client.post(`/conversations/${id}/leave`);
    const state: MlsGroupState = await first.client.get(`/mls/conversations/${id}`);
    expect(state.pendingRemovals.map((entry) => entry.userId)).toEqual([leaver.client.id]);

    const blocked = await encryptText(first.state!, "too soon", cs);
    expect(await status(submit(first, id, blocked.message))).toBe(409);
    // Removing someone who's still a member isn't allowed.
    const kick = await removeUser(first.state!, second.client.id, cs);
    expect(await status(submit(first, id, kick.commit, { groupInfo: kick.groupInfo }))).toBe(403);

    const removal = await removeUser(first.state!, leaver.client.id, cs);
    await submit(first, id, removal.commit, { groupInfo: removal.groupInfo });
    first.state = removal.state;
    const now = await encryptText(first.state, "now it's just us", cs);
    await submit(first, id, now.message);
    first.state = now.state;
    expect(await catchUp(second, id)).toEqual(["now it's just us"]);
    // The leaver can't read the log any more.
    expect(await status(leaver.client.get(`/mls/conversations/${id}/messages?since=0`))).toBe(404);
  });
  it("sends a blocked person's MLS messages to the blocker's phone without counting them as unread", async () => {
    const people = await Promise.all(Array.from({ length: 4 }, () => person("seattle-wa-us")));
    let groupId: string | null = null;
    for (const client of people) groupId = (await client.post("/deck/topics/everyday-physics/swipe", { direction: "right" })).groupConversationId ?? groupId;
    expect(groupId).toBeTruthy();
    const id = groupId!;
    const phones = await Promise.all(people.map(phone));
    const [first, blocker, other, sender] = phones as [Phone, Phone, Phone, Phone];
    await startOnServer(first, id);
    await addAll(first, id, phones.slice(1));

    await blocker.client.post(`/safety/blocks/${sender.client.id}`);
    for (const p of [blocker, other]) await p.client.post(`/conversations/${id}/read`);
    const sent = await encryptText(sender.state!, "hello all", cs);
    await submit(sender, id, sent.message);
    sender.state = sent.state;

    const inboxRow = async (p: Phone) => ((await p.client.get("/conversations")) as { id: string; unreadCount: number }[]).find((row) => row.id === id)!;
    expect((await inboxRow(other)).unreadCount).toBe(1);
    expect((await inboxRow(blocker)).unreadCount).toBe(0);
    // The entry still reaches the blocker's phone, which needs it to stay in step. The app hides it there.
    expect(await catchUp(blocker, id)).toEqual(["hello all"]);
  });

  it("lets one chat take only a few of a phone's key packages before it's added", async () => {
    const { a, b, conversationId } = await directChat("space-exploration");
    const [alice, bob] = await Promise.all([phone(a), phone(b)]);
    const bobDevice = bob.client.device.publicKey;
    const more = await Promise.all(Array.from({ length: 4 }, () => anotherKeyPackage(bob.device, cs)));
    await b.post("/mls/key-packages", { deviceId: bobDevice, keyPackages: more.map((device) => toBase64(encodeKeyPackage(device))) });
    const available = async () => ((await b.get(`/mls/key-packages/${bobDevice}`)) as { available: number }).available;
    expect(await available()).toBe(5);
    await startOnServer(alice, conversationId);

    // Alice keeps claiming Bob's packages without adding him. The first few cover lost races.
    const claimBob = () => a.post(`/mls/conversations/${conversationId}/key-packages`, { deviceIds: [bobDevice] }) as Promise<{ keyPackages: { keyPackage: string }[]; missing: string[] }>;
    const fresh = [await claimBob(), await claimBob(), await claimBob()];
    expect(new Set(fresh.map((claimed) => claimed.keyPackages[0]!.keyPackage)).size).toBe(3);
    expect(await claimBob()).toEqual({ keyPackages: [], missing: [bobDevice] });
    expect(await available()).toBe(2);

    // With a last-resort package uploaded, later claims get that one, which isn't used up.
    const lastResort = toBase64(encodeKeyPackage(await anotherKeyPackage(bob.device, cs)));
    await b.post("/mls/key-packages", { deviceId: bobDevice, keyPackages: [], lastResort });
    expect((await claimBob()).keyPackages.map((claimed) => claimed.keyPackage)).toEqual([lastResort]);
    expect(await available()).toBe(2);
  });

  it("waits to move a chat to MLS until everyone has a phone that can follow", async () => {
    const { a, b, conversationId } = await directChat("philosophy-of-science");
    const alice = await phone(a);
    // Bob's app can't do MLS yet, so starting the group would lock him out.
    await expect(startOnServer(alice, conversationId)).rejects.toMatchObject({ status: 409, body: { error: "not_ready" } });
    expect((await a.get(`/mls/conversations/${conversationId}`)).mode).toBe("v1");
    await phone(b);
    await startOnServer(alice, conversationId);
    expect((await a.get(`/mls/conversations/${conversationId}`)).mode).toBe("mls");
  });

  it("lets a new phone join by itself, with nobody else online", async () => {
    const { a, b, conversationId } = await directChat("quantum-mechanics-and-interpretation");
    const [alice, bob] = await Promise.all([phone(a), phone(b)]);
    await startOnServer(alice, conversationId);
    await addAll(alice, conversationId, [bob]);

    // Bob signs in on a new phone. It has its own keys, and nobody adds it.
    const newPhone = await phone(await new Client(BASE).signIn(b.email));
    const server: MlsGroupState = await newPhone.client.get(`/mls/conversations/${conversationId}`);
    expect(server.pendingAdds.map((device) => device.deviceId)).toEqual([newPhone.client.device.publicKey]);
    const { groupInfo } = await newPhone.client.get(`/mls/conversations/${conversationId}/group-info`);
    const joined = await joinExternally(fromBase64(groupInfo), newPhone.device, cs, trustFrom(server));
    const entry = await submit(newPhone, conversationId, joined.commit, { groupInfo: joined.groupInfo });
    newPhone.state = joined.state;
    newPhone.cursor = entry.seq;

    // Alice applies the external commit when she's next online, and the new phone reads what she sends.
    expect(await catchUp(alice, conversationId)).toEqual([]);
    const hello = await encryptText(alice.state!, "Welcome back", cs);
    await submit(alice, conversationId, hello.message);
    alice.state = hello.state;
    expect(await catchUp(newPhone, conversationId)).toEqual(["Welcome back"]);
    const after: MlsGroupState = await a.get(`/mls/conversations/${conversationId}`);
    expect(after.roster.filter((entry) => entry.userId === b.id)).toHaveLength(2);
    expect(after.pendingAdds).toEqual([]);
  });
});
