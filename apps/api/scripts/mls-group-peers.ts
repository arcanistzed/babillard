// Plays three other members of an MLS group chat, so the app can be tried on a phone against a local Worker.
// Run a local Worker with DEV_MODE=true and MLS_ENABLED=true, then:
//   ../../node_modules/.bin/tsx scripts/mls-group-peers.ts http://localhost:8787
// It creates Alice, Bob, Carol and Dave in one city, forms a group on a topic they all like, and prints a
// link that signs the phone in as Alice. Bob, Carol and Dave then run the shared sync engine (with ts-mls).
// Each says hello once the group exists. They answer what the phone sends:
//   "ping"  → Bob answers "pong from Bob".
//   "carol" → Carol says "Carol again". Block Carol on the phone first, and this shouldn't show.
//   "leave" → Dave leaves the chat, and Bob then says "Dave left", which removes Dave's phone first.
// It stops after "leave" is handled, or after fifteen minutes.
import { MemoryMlsStore, MlsMessenger, httpMlsTransport, type HttpCall } from "@babillard/shared";
import { mlsCiphersuite, tsMlsCrypto } from "@babillard/shared/mls";
import { randomBytes } from "node:crypto";
import { createPerson, type Client } from "./api-client.ts";

const base = process.argv[2] ?? "http://localhost:8787";
const stamp = Date.now().toString(36);
const topicId = "everyday-physics";
const cityId = "chicago-il-us";

const make = (name: string) => createPerson(base, `${name.toLowerCase()}-${stamp}@example.test`, { displayName: name, cityId });
const alice = await make("Alice");
const others = { bob: await make("Bob"), carol: await make("Carol"), dave: await make("Dave") };
let conversationId: string | null = null;
for (const client of [alice, others.bob, others.carol, others.dave]) {
  const swiped = await client.post<{ groupConversationId?: string }>(`/deck/topics/${topicId}/swipe`, { direction: "right" });
  conversationId = swiped.groupConversationId ?? conversationId;
}
if (!conversationId) throw new Error("no group formed");
const chat = conversationId;
const { devToken } = await alice.post<{ devToken: string }>("/auth/start", { email: `alice-${stamp}@example.test` });
const log = (event: Record<string, unknown>) => console.log(JSON.stringify(event));
log({ event: "ready", conversationId: chat, carolId: others.carol.id, signInLink: `babillard://auth/link?token=${encodeURIComponent(devToken)}`, chatLink: `babillard://chat/${chat}` });

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
const peers = Object.entries(others).map(([name, client]) => ({ name, client, messenger: messengerFor(client), greeted: false, active: true }));
for (const peer of peers) await peer.messenger.ensureIdentity();
const [bob, carol, dave] = peers as [(typeof peers)[number], (typeof peers)[number], (typeof peers)[number]];

async function say(peer: (typeof peers)[number], text: string) {
  await peer.messenger.send(chat, text);
  log({ event: "sent", by: peer.name, text, code: await peer.messenger.securityCode(chat) });
}

const deadline = Date.now() + 15 * 60 * 1000;
let finished = false;
while (Date.now() < deadline && !finished) {
  for (const peer of peers) {
    // Checked here, not when the round starts: Dave can leave partway through one.
    if (!peer.active) continue;
    try {
      const received = await peer.messenger.sync(chat);
      for (const message of received) log({ event: "received", by: peer.name, from: message.senderId === alice.id ? "alice" : message.senderId, text: message.text });
      if (!peer.greeted && (await peer.messenger.inGroup(chat))) {
        await say(peer, `Hello from ${peer.name[0]!.toUpperCase()}${peer.name.slice(1)}`);
        peer.greeted = true;
      }
      // Only Bob answers, so each request is handled once.
      if (peer !== bob) continue;
      const fromAlice = received.filter((message) => message.senderId === alice.id).map((message) => message.text.toLowerCase());
      if (fromAlice.some((text) => text.includes("ping"))) await say(bob, "pong from Bob");
      if (fromAlice.some((text) => text.includes("carol"))) await say(carol, "Carol again");
      if (fromAlice.some((text) => text.includes("leave"))) {
        await dave.client.post(`/conversations/${chat}/leave`);
        dave.active = false;
        log({ event: "left", by: "dave" });
        await say(bob, "Dave left");
        const state = await bob.client.get<{ roster: { userId: string }[]; epoch: number }>(`/mls/conversations/${chat}`);
        log({ event: "roster", phones: state.roster.length, epoch: state.epoch });
        finished = true;
      }
    } catch (error) {
      log({ event: "error", by: peer.name, error: String(error) });
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
log({ event: "done" });
