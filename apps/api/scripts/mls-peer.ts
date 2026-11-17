// Plays the other side of an MLS chat, so the app can be tried on a phone against a local Worker.
// Run a local Worker with DEV_MODE=true and MLS_ENABLED=true, then:
//   ../../node_modules/.bin/tsx scripts/mls-peer.ts http://localhost:8787
// It creates Alice and Bob with a direct chat, prints a link that signs the phone in as Alice,
// and then runs Bob on the shared sync engine (with ts-mls): he says hello once the group exists,
// and answers "pong" when the phone sends "ping". It stops after that, or after ten minutes.
import { MemoryMlsStore, MlsMessenger, httpMlsTransport, type HttpCall } from "@babillard/shared";
import { mlsCiphersuite, tsMlsCrypto } from "@babillard/shared/mls";
import { randomBytes } from "node:crypto";
import { createPerson } from "./api-client.ts";

const base = process.argv[2] ?? "http://localhost:8787";
const stamp = Date.now().toString(36);
const topicId = "astrophysics-and-cosmology";

const alice = await createPerson(base, `alice-${stamp}@example.test`, { displayName: "Alice", cityId: "chicago-il-us" });
const bob = await createPerson(base, `bob-${stamp}@example.test`, { displayName: "Bob", cityId: "chicago-il-us" });
await alice.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
await bob.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
await alice.post(`/people/${bob.id}/swipe`, { direction: "right" });
const { conversationId } = await bob.post<{ conversationId: string }>(`/people/${alice.id}/swipe`, { direction: "right" });
const { devToken } = await alice.post<{ devToken: string }>("/auth/start", { email: `alice-${stamp}@example.test` });

console.log(JSON.stringify({ event: "ready", conversationId, signInLink: `babillard://auth/link?token=${encodeURIComponent(devToken)}`, chatLink: `babillard://chat/${conversationId}` }));

const call: HttpCall = async (method, path, body) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${bob.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
const crypto = tsMlsCrypto(mlsCiphersuite((length) => new Uint8Array(randomBytes(length))));
const messenger = new MlsMessenger(crypto, httpMlsTransport(call), new MemoryMlsStore(), { userId: bob.id, deviceId: bob.device.publicKey });
await messenger.ensureIdentity();

const deadline = Date.now() + 10 * 60 * 1000;
let greeted = false;
while (Date.now() < deadline) {
  try {
    const received = await messenger.sync(conversationId);
    for (const message of received) console.log(JSON.stringify({ event: "received", text: message.text }));
    if (!greeted && (await messenger.inGroup(conversationId))) {
      await messenger.send(conversationId, "Hello from Bob");
      console.log(JSON.stringify({ event: "sent", text: "Hello from Bob", code: await messenger.securityCode(conversationId) }));
      greeted = true;
    }
    if (received.some((message) => message.text.toLowerCase().includes("ping"))) {
      await messenger.send(conversationId, "pong from Bob");
      console.log(JSON.stringify({ event: "sent", text: "pong from Bob", code: await messenger.securityCode(conversationId) }));
      break;
    }
  } catch (error) {
    console.log(JSON.stringify({ event: "error", error: String(error) }));
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
console.log(JSON.stringify({ event: "done" }));
