// Retiring one of your own phones, through the real Worker. The MLS phones are ts-mls clients in
// Node, as in mls.e2e.ts; the topics are physics ones for the same reason given there,
// and each test has its own so no group forms.
import { fromBase64, toBase64, type MlsGroupState, type MlsLogEntry, type SignedInPhone } from "@babillard/shared";
import { addDevices, anotherKeyPackage, clientConfig, createDevice, encodeKeyPackage, encryptText, joinFromWelcome, mlsCiphersuite, receive, removeLeaves, startGroup, type MlsDevice } from "@babillard/shared/mls";
import { randomBytes } from "node:crypto";
import type { ClientState } from "ts-mls";
import { describe, expect, it } from "vitest";
import { ApiError, Client, createPerson } from "../scripts/api-client.ts";

const PORT_OFFSET = Number(process.env.E2E_PORT_OFFSET ?? 0);
const BASE = `http://localhost:${8799 + PORT_OFFSET}`;
const cs = mlsCiphersuite((length) => new Uint8Array(randomBytes(length)));

let counter = 0;
async function person(): Promise<Client & { email: string }> {
  counter += 1;
  const email = `phones-${counter}-${Date.now()}@example.test`;
  return Object.assign(await createPerson(BASE, email, { displayName: `Phones ${counter}`, cityId: "denver-co-us" }), { email });
}

/** Another phone for the same person: its own session and its own device key. */
async function anotherPhone(email: string): Promise<Client> {
  return new Client(BASE).signIn(email);
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

const retire = (client: Client, publicKey: string) => client.post("/me/devices/retire", { publicKey, thisDevice: client.device.publicKey });
const listed = async (client: Client) => ((await client.get<SignedInPhone[]>("/me/devices")).map((phone) => phone.publicKey)).sort();

interface Phone {
  client: Client;
  device: MlsDevice;
  state: ClientState | null;
  cursor: number;
}

async function mlsPhone(client: Client): Promise<Phone> {
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

/** The first phone starts the group and adds the others from their key packages. */
async function startWith(first: Phone, conversationId: string, others: Phone[]): Promise<void> {
  const server: MlsGroupState = await first.client.get(`/mls/conversations/${conversationId}`);
  const created = await addDevices(await startGroup(conversationId, first.device, cs, trustFrom(server)), [], cs);
  first.cursor = (await submit(first, conversationId, created.commit, { groupInfo: created.groupInfo })).seq;
  first.state = created.state;
  const claimed = await first.client.post(`/mls/conversations/${conversationId}/key-packages`, { deviceIds: others.map((o) => o.client.device.publicKey) });
  expect(claimed.missing).toEqual([]);
  const added = await addDevices(first.state, claimed.keyPackages.map((k: { keyPackage: string }) => fromBase64(k.keyPackage)), cs);
  first.cursor = (await submit(first, conversationId, added.commit, { welcome: added.welcome!, groupInfo: added.groupInfo })).seq;
  first.state = added.state;
  for (const other of others) {
    const state: MlsGroupState = await other.client.get(`/mls/conversations/${conversationId}`);
    const { seq, welcome } = await other.client.get(`/mls/conversations/${conversationId}/welcome/${other.client.device.publicKey}`);
    other.state = await joinFromWelcome(fromBase64(welcome), other.device, cs, trustFrom(state));
    other.cursor = seq;
  }
}

describe("signed-in phones", () => {
  it("lists a person's phones and retires a lost one, which is signed out and can't come back by itself", async () => {
    const a = await person();
    const lost = await anotherPhone(a.email);
    const third = await anotherPhone(a.email);
    const b = await person();

    const phones = await a.get<SignedInPhone[]>("/me/devices");
    expect(phones.map((phone) => phone.publicKey).sort()).toEqual([a.device.publicKey, lost.device.publicKey, third.device.publicKey].sort());
    expect(phones.every((phone) => typeof phone.lastOpenedAt === "number")).toBe(true);
    // Only the caller's own phones.
    expect(await listed(b)).toEqual([b.device.publicKey]);

    // Not someone else's phone, and not the phone asking: that's signing out.
    expect(await status(retire(a, b.device.publicKey))).toBe(404);
    expect(await listed(b)).toEqual([b.device.publicKey]);
    expect(await status(retire(a, a.device.publicKey))).toBe(409);
    expect(await status(a.post("/me/devices/retire", { publicKey: "not a key", thisDevice: a.device.publicKey }))).toBe(400);

    expect(await retire(a, lost.device.publicKey)).toEqual({ ok: true });
    expect(await listed(a)).toEqual([a.device.publicKey, third.device.publicKey].sort());
    expect(await status(retire(a, lost.device.publicKey))).toBe(404);

    // The lost phone's session is gone, so opening the app can't register its key again.
    expect(await status(lost.get("/me"))).toBe(401);
    expect(await status(lost.post("/me/device-key", { publicKey: lost.device.publicKey }))).toBe(401);
    expect(await listed(a)).toEqual([a.device.publicKey, third.device.publicKey].sort());
    // The person's other phones sign in again, and keep their key.
    expect(await status(third.get("/me"))).toBe(401);
    expect(await status(a.get("/me"))).toBe(200);
    await third.signIn(a.email);
    expect(await listed(a)).toEqual([a.device.publicKey, third.device.publicKey].sort());

    // Found again: signing in with the email code brings the same key back.
    await lost.signIn(a.email);
    expect(await listed(a)).toEqual([a.device.publicKey, lost.device.publicKey, third.device.publicKey].sort());
  });

  it("stops sealing v1 messages for a retired phone", async () => {
    const a = await person();
    const b = await person();
    const lost = await anotherPhone(a.email);
    await a.post("/deck/topics/astronomy-for-amateurs/swipe", { direction: "right" });
    await b.post("/deck/topics/astronomy-for-amateurs/swipe", { direction: "right" });
    await a.post(`/people/${b.id}/swipe`, { direction: "right" });
    const { conversationId } = await b.post(`/people/${a.id}/swipe`, { direction: "right" });
    expect(conversationId).toBeTruthy();

    await retire(a, lost.device.publicKey);
    const detail = await b.get(`/conversations/${conversationId}`);
    const alice = detail.members.find((member: { id: string }) => member.id === a.id);
    expect(alice.deviceKeys).toEqual([a.device.publicKey]);
    expect(alice.retiredDeviceKeys).toEqual([lost.device.publicKey]);
    // Bob's phone seals for Alice's phones that are left, and the server takes it.
    await b.say(conversationId, "only your phone now");
    expect((await a.read(conversationId)).map((message) => message.body)).toContain("only your phone now");
  });

  it("makes a retired phone a pending removal in its MLS chats, which the next sender removes", async () => {
    const a = await person();
    const b = await person();
    const lostClient = await anotherPhone(a.email);
    await a.post("/deck/topics/quantum-physics-without-the-hype/swipe", { direction: "right" });
    await b.post("/deck/topics/quantum-physics-without-the-hype/swipe", { direction: "right" });
    await a.post(`/people/${b.id}/swipe`, { direction: "right" });
    const { conversationId } = await b.post(`/people/${a.id}/swipe`, { direction: "right" });

    const [alice, lost, bob] = await Promise.all([mlsPhone(a), mlsPhone(lostClient), mlsPhone(b)]);
    await startWith(alice, conversationId, [lost, bob]);
    const before: MlsGroupState = await b.get(`/mls/conversations/${conversationId}`);
    expect(before.roster.map((entry) => entry.deviceId).sort()).toEqual([a.device.publicKey, lostClient.device.publicKey, b.device.publicKey].sort());

    // The lost phone has a spare package up.
    const lostId = lostClient.device.publicKey;
    await lostClient.post("/mls/key-packages", { deviceId: lostId, keyPackages: [toBase64(encodeKeyPackage(await anotherKeyPackage(lost.device, cs)))] });
    expect(await lostClient.get(`/mls/key-packages/${lostId}`)).toEqual({ available: 1, lastResort: false });

    await retire(a, lostId);
    const after: MlsGroupState = await b.get(`/mls/conversations/${conversationId}`);
    expect(after.directory.map((entry) => entry.deviceId)).not.toContain(lostClient.device.publicKey);
    expect(after.pendingRemovals).toEqual([expect.objectContaining({ userId: a.id, deviceId: lostClient.device.publicKey })]);
    expect(after.pendingAdds).toEqual([]);

    // Bob can't send until the phone is removed. Removing it is allowed, and then his message goes through.
    expect(await catchUp(bob, conversationId)).toEqual([]);
    const early = await encryptText(bob.state!, "too soon", cs);
    expect(await status(submit(bob, conversationId, early.message))).toBe(409);
    const removal = await removeLeaves(bob.state!, after.pendingRemovals.map((entry) => entry.leafIndex), cs);
    await submit(bob, conversationId, removal.commit, { groupInfo: removal.groupInfo });
    bob.state = removal.state;
    const hello = await encryptText(bob.state, "lost phone's gone", cs);
    await submit(bob, conversationId, hello.message);
    bob.state = hello.state;

    expect(await catchUp(alice, conversationId)).toEqual(["lost phone's gone"]);
    const removed: MlsGroupState = await a.get(`/mls/conversations/${conversationId}`);
    expect(removed.roster.map((entry) => entry.deviceId).sort()).toEqual([a.device.publicKey, b.device.publicKey].sort());
    expect(removed.pendingRemovals).toEqual([]);
    // The lost phone was signed out, so it can't read the log either.
    expect(await status(lostClient.get(`/mls/conversations/${conversationId}/messages?since=0`))).toBe(401);
    // Found and signed in again, it starts with no key packages: retiring deleted them.
    await lostClient.signIn(a.email);
    expect(await lostClient.get(`/mls/key-packages/${lostClient.device.publicKey}`)).toEqual({ available: 0, lastResort: false });
  });
});
