// Tries a person's second phone in an MLS chat that's already running, against a local Worker.
// Run a local Worker with DEV_MODE=true and MLS_ENABLED=true, then:
//   ../../node_modules/.bin/tsx scripts/mls-second-phone.ts http://localhost:8787
// It creates Alice and Bob with a direct chat. Alice's first phone (scripted) and Bob move the chat to MLS
// and trade a message. Then it prints a link that signs the phone in as Alice, and both scripted phones
// stay quiet, so nobody can add the new phone: it has to join by itself with an external commit.
// Once the server shows it in the group, they sync again and greet it:
//   Bob says "Hi, Alice's new phone", and Alice's first phone says "Hello from my first phone".
//   When the new phone sends "ping", Bob answers "pong from Bob".
// It prints every phone's security code along the way, and stops after the pong, or after fifteen minutes.
import { MemoryMlsStore, MlsMessenger, httpMlsTransport, type HttpCall, type MlsGroupState } from "@babillard/shared";
import { mlsCiphersuite, tsMlsCrypto } from "@babillard/shared/mls";
import { randomBytes } from "node:crypto";
import { createPerson, type Client } from "./api-client.ts";

const base = process.argv[2] ?? "http://localhost:8787";
const stamp = Date.now().toString(36);
const topicId = "quantum-physics-without-the-hype";
const email = `alice-${stamp}@example.test`;

const alice = await createPerson(base, email, { displayName: "Alice", cityId: "chicago-il-us" });
const bob = await createPerson(base, `bob-${stamp}@example.test`, { displayName: "Bob", cityId: "chicago-il-us" });
await alice.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
await bob.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
await alice.post(`/people/${bob.id}/swipe`, { direction: "right" });
const { conversationId: chat } = await bob.post<{ conversationId: string }>(`/people/${alice.id}/swipe`, { direction: "right" });
const log = (event: Record<string, unknown>) => console.log(JSON.stringify(event));

const crypto = tsMlsCrypto(mlsCiphersuite((length) => new Uint8Array(randomBytes(length))));
function messengerFor(client: Client) {
  const call: HttpCall = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${client.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  return new MlsMessenger(crypto, httpMlsTransport(call), new MemoryMlsStore(), { userId: client.id, deviceId: client.device.publicKey });
}
const firstPhone = messengerFor(alice);
const bobPhone = messengerFor(bob);
await firstPhone.ensureIdentity();
await bobPhone.ensureIdentity();
const label = (senderId: string) => (senderId === alice.id ? "alice" : senderId === bob.id ? "bob" : senderId);

// The chat moves to MLS between Alice's first phone and Bob.
await firstPhone.sync(chat);
await bobPhone.sync(chat);
await firstPhone.send(chat, "Hello from Alice's first phone");
for (const message of await bobPhone.sync(chat)) log({ event: "received", by: "bob", from: label(message.senderId), text: message.text });
const groupState = () => bob.get<MlsGroupState>(`/mls/conversations/${chat}`);
const before = await groupState();
log({ event: "group", mode: before.mode, phones: before.roster.length, code: await bobPhone.securityCode(chat) });

const { devToken } = await alice.post<{ devToken: string }>("/auth/start", { email });
log({ event: "ready", conversationId: chat, signInLink: `babillard://auth/link?token=${encodeURIComponent(devToken)}`, chatLink: `babillard://chat/${chat}` });

// Quiet until the new phone is in the group by itself.
const deadline = Date.now() + 15 * 60 * 1000;
const known = new Set(before.roster.map((entry) => entry.deviceId));
let newPhone: string | null = null;
while (Date.now() < deadline && !newPhone) {
  const state = await groupState();
  newPhone = state.roster.find((entry) => entry.userId === alice.id && !known.has(entry.deviceId))?.deviceId ?? null;
  if (!newPhone) await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (!newPhone) throw new Error("the new phone never joined");
const joined = await groupState();
log({ event: "joined", phones: joined.roster.length, pendingAdds: joined.pendingAdds.length, epoch: joined.epoch });

for (const [name, phone] of [["bob", bobPhone], ["alice-first", firstPhone]] as const) {
  for (const message of await phone.sync(chat)) log({ event: "received", by: name, from: label(message.senderId), text: message.text });
}
await bobPhone.send(chat, "Hi, Alice's new phone");
await firstPhone.send(chat, "Hello from my first phone");
log({ event: "codes", bob: await bobPhone.securityCode(chat), aliceFirst: await firstPhone.securityCode(chat) });

let ponged = false;
while (Date.now() < deadline && !ponged) {
  for (const [name, phone] of [["bob", bobPhone], ["alice-first", firstPhone]] as const) {
    try {
      const received = await phone.sync(chat);
      for (const message of received) log({ event: "received", by: name, from: label(message.senderId), text: message.text });
      if (name === "bob" && received.some((message) => message.text.toLowerCase().includes("ping"))) {
        await bobPhone.send(chat, "pong from Bob");
        log({ event: "sent", by: "bob", text: "pong from Bob" });
        ponged = true;
      }
    } catch (error) {
      log({ event: "error", by: name, error: String(error) });
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
// Alice's first phone reads the pong too.
for (const message of await firstPhone.sync(chat)) log({ event: "received", by: "alice-first", from: label(message.senderId), text: message.text });
log({ event: "done" });
