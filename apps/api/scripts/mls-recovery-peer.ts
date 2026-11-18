// Plays Bob in an MLS chat for trying recovery and reports on a phone against a local Worker.
// Run a local Worker with DEV_MODE=true and MLS_ENABLED=true, then:
//   ../../node_modules/.bin/tsx scripts/mls-recovery-peer.ts http://localhost:8788 [minutes]
// It creates Alice and Bob with a direct chat and prints a link that signs the phone in as Alice.
// Once the group exists, Bob sends a hello and a line with a random word in it, for reporting.
// Then he stays (30 minutes by default), logs every message he reads with its log position, and
// says when the same text arrives twice. After a lost answer, the phone's message must show up once.
// He answers "pong: ..." to any message starting with "ping", so the phone can see he still reads it.
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

console.log(JSON.stringify({ event: "ready", conversationId, aliceId: alice.id, bobId: bob.id, signInLink: `babillard://auth/link?token=${encodeURIComponent(devToken)}`, chatLink: `babillard://chat/${conversationId}` }));

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

const reportable = `Bob's line to report: ${randomBytes(4).toString("hex")}`;
const deadline = Date.now() + Number(process.argv[3] ?? 30) * 60 * 1000;
const seen = new Map<string, number[]>();
let greeted = false;
await messenger.ensureIdentity();
while (Date.now() < deadline) {
  try {
    const received = await messenger.sync(conversationId);
    for (const message of received) {
      const positions = [...(seen.get(message.text) ?? []), message.seq ?? -1];
      seen.set(message.text, positions);
      console.log(JSON.stringify({ event: "received", seq: message.seq, text: message.text, ...(positions.length > 1 ? { duplicate: positions } : {}) }));
      if (message.text.toLowerCase().startsWith("ping")) {
        const sent = await messenger.send(conversationId, `pong: ${message.text}`);
        console.log(JSON.stringify({ event: "sent", seq: sent.seq, text: sent.text }));
      }
    }
    if (!greeted && (await messenger.inGroup(conversationId))) {
      for (const text of ["Hello from Bob", reportable]) {
        const sent = await messenger.send(conversationId, text);
        console.log(JSON.stringify({ event: "sent", seq: sent.seq, text }));
      }
      console.log(JSON.stringify({ event: "code", code: await messenger.securityCode(conversationId) }));
      greeted = true;
    }
  } catch (error) {
    console.log(JSON.stringify({ event: "error", error: String(error) }));
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
console.log(JSON.stringify({ event: "done" }));
