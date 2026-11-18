// Retiring one of your own phones, through the real Worker. Each test makes its own people, and
// the chat uses a physics topic, as the deck tests expect.
import type { SignedInPhone } from "@babillard/shared";
import { describe, expect, it } from "vitest";
import { ApiError, Client, createPerson } from "../scripts/api-client.ts";

const PORT_OFFSET = Number(process.env.E2E_PORT_OFFSET ?? 0);
const BASE = `http://localhost:${8799 + PORT_OFFSET}`;

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
});
