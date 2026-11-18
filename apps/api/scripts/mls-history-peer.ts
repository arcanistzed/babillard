// Tries backup v2 on a phone against a local Worker: restoring a backup brings back MLS history.
// Run a local Worker with DEV_MODE=true and MLS_ENABLED=true, then:
//   ../../node_modules/.bin/tsx scripts/mls-history-peer.ts http://localhost:8787 <backup file to write>
// It creates Alice and Bob with a direct chat. Alice's first phone and Bob (both scripted) move it to
// MLS and trade three messages, and the first phone backs up its history. It writes Alice's backup
// file, with the passphrase "correct horse", and prints a link that signs the phone in as Alice.
// The phone joins the chat after those messages, so it can't read them, until it restores the file.
// Bob answers "pong from Bob" when the phone sends "ping". It stops then, or after fifteen minutes.
import { MemoryMlsStore, MlsMessenger, createKeyBackup, httpMlsTransport, type HttpCall } from "@babillard/shared";
import { mlsCiphersuite, tsMlsCrypto } from "@babillard/shared/mls";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createPerson, type Client } from "./api-client.ts";

const base = process.argv[2] ?? "http://localhost:8787";
const backupPath = process.argv[3] ?? "babillard-key-backup.json";
const stamp = Date.now().toString(36);
const topicId = "everyday-physics";
const email = `alice-${stamp}@example.test`;
const random = (length: number) => new Uint8Array(randomBytes(length));

const alice = await createPerson(base, email, { displayName: "Alice", cityId: "chicago-il-us" });
const bob = await createPerson(base, `bob-${stamp}@example.test`, { displayName: "Bob", cityId: "chicago-il-us" });
await alice.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
await bob.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
await alice.post(`/people/${bob.id}/swipe`, { direction: "right" });
const { conversationId: chat } = await bob.post<{ conversationId: string }>(`/people/${alice.id}/swipe`, { direction: "right" });
const log = (event: Record<string, unknown>) => console.log(JSON.stringify(event));

const crypto = tsMlsCrypto(mlsCiphersuite(random));
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

const [aliceFirst, bobPhone] = [messengerFor(alice), messengerFor(bob)];
await aliceFirst.ensureIdentity();
await bobPhone.ensureIdentity();
await aliceFirst.sync(chat);
await bobPhone.sync(chat);
await aliceFirst.sync(chat);
await bobPhone.send(chat, "Before your new phone: one");
await aliceFirst.sync(chat);
await aliceFirst.send(chat, "Before your new phone: two, from Alice's first phone");
await bobPhone.send(chat, "Before your new phone: three");
await aliceFirst.sync(chat);

const historyKey = random(32);
log({ event: "history", outcome: await aliceFirst.enableHistory(historyKey) });
writeFileSync(backupPath, JSON.stringify(await createKeyBackup([alice.device.secretKey], "correct horse", random, historyKey)));
const { devToken } = await alice.post<{ devToken: string }>("/auth/start", { email });
log({ event: "ready", conversationId: chat, backupFile: backupPath, signInLink: `babillard://auth/link?token=${encodeURIComponent(devToken)}`, chatLink: `babillard://chat/${chat}` });

const deadline = Date.now() + 15 * 60 * 1000;
while (Date.now() < deadline) {
  try {
    const received = await bobPhone.sync(chat);
    for (const message of received) log({ event: "received", text: message.text });
    if (received.some((message) => message.text.toLowerCase().includes("ping"))) {
      await bobPhone.send(chat, "pong from Bob");
      log({ event: "sent", text: "pong from Bob" });
      break;
    }
  } catch (error) {
    log({ event: "error", error: String(error) });
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
log({ event: "done" });
