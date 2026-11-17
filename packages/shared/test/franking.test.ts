import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkFranking, decodeFrankedPayload, encodeFrankedPayload, frankingCommitment } from "../src/franking";
import { MemoryMlsStore, MlsMessenger, type MlsCrypto } from "../src/mlsClient";
import { MemoryMlsServer } from "../src/mlsMemoryServer";
import { readFrame } from "../src/mlsWire";
import { tsMlsCrypto } from "../src/mls/adapter";
import { mlsCiphersuite } from "../src/mls/provider";
import { fromBase64 } from "../src/e2ee";

const random = (length: number) => webcrypto.getRandomValues(new Uint8Array(length));

describe("message franking", () => {
  const key = random(32);
  const commitment = frankingCommitment(key, "chat-1", "mallory", "meet me alone");

  it("checks the text, sender and chat a commitment was made for", () => {
    expect(checkFranking(commitment, key, "chat-1", "mallory", "meet me alone")).toBe(true);
    expect(checkFranking(commitment, key, "chat-1", "mallory", "meet me at the library")).toBe(false);
    expect(checkFranking(commitment, key, "chat-1", "alice", "meet me alone")).toBe(false);
    expect(checkFranking(commitment, key, "chat-2", "mallory", "meet me alone")).toBe(false);
    expect(checkFranking(commitment, random(32), "chat-1", "mallory", "meet me alone")).toBe(false);
  });

  it("keeps the inputs apart, so moving text between them changes the commitment", () => {
    expect(checkFranking(frankingCommitment(key, "chat-1", "mal", "lory: hi"), key, "chat-1", "mallory", ": hi")).toBe(false);
  });

  it("carries the key inside the message with the text, and refuses anything else", () => {
    expect(decodeFrankedPayload(encodeFrankedPayload("hello ✨", key))).toEqual({ text: "hello ✨", frankingKey: key });
    expect(decodeFrankedPayload(new TextEncoder().encode("plain old text from before franking"))).toBeNull();
    expect(decodeFrankedPayload(Uint8Array.of(1, 2, 3))).toBeNull();
    const badText = encodeFrankedPayload("", key);
    expect(decodeFrankedPayload(Uint8Array.from([...badText, 0xff, 0xfe]))).toBeNull();
  });
});

describe("franking through the sync engine", () => {
  const crypto = tsMlsCrypto(mlsCiphersuite(random));
  const CHAT = "chat";

  async function pair(senderCrypto: MlsCrypto = crypto) {
    const server = new MemoryMlsServer();
    server.setMembers(CHAT, ["alice", "bob"]);
    const bobStore = new MemoryMlsStore();
    const alice = new MlsMessenger(senderCrypto, server.transportFor("alice", "alice-phone"), new MemoryMlsStore(), { userId: "alice", deviceId: "alice-phone" });
    const bob = new MlsMessenger(crypto, server.transportFor("bob", "bob-phone"), bobStore, { userId: "bob", deviceId: "bob-phone" });
    await alice.ensureIdentity();
    await bob.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    return { server, alice, bob, bobStore };
  }

  it("lets the receiver prove what was sent, using only what the server stored", async () => {
    const { server, alice, bob } = await pair();
    await alice.send(CHAT, "see you Thursday");
    const [received] = await bob.sync(CHAT);
    expect(received).toMatchObject({ text: "see you Thursday" });
    expect(received!.frankingKey).toHaveLength(32);
    expect(received!.unverified).toBeUndefined();

    // What a moderator's check would do: the commitment from the stored message, the key and text from the reporter.
    const [entry] = (await server.transportFor("bob", "bob-phone").log(CHAT, received!.seq! - 1)).filter((e) => e.seq === received!.seq);
    const frame = readFrame(fromBase64(entry!.message));
    expect(frame.wireformat).toBe("private");
    const commitment = frame.wireformat === "private" ? frame.authenticatedData : new Uint8Array();
    expect(checkFranking(commitment, received!.frankingKey!, CHAT, "alice", "see you Thursday")).toBe(true);
    expect(checkFranking(commitment, received!.frankingKey!, CHAT, "alice", "see you Friday")).toBe(false);
  });

  it("keeps a message whose commitment doesn't match, marked, and carries on", async () => {
    // Alice's phone commits to different text than it sends.
    const lying: MlsCrypto = {
      ...crypto,
      encrypt: (state, conversationId, plaintext, aad) => {
        const opened = decodeFrankedPayload(plaintext)!;
        return crypto.encrypt(state, conversationId, plaintext, aad.length ? frankingCommitment(opened.frankingKey, conversationId, "alice", "something harmless") : aad);
      },
    };
    const { alice, bob, bobStore } = await pair(lying);
    await alice.send(CHAT, "something nasty");
    await alice.send(CHAT, "and more");
    const received = await bob.sync(CHAT);
    expect(received.map((m) => [m.text, m.unverified, m.frankingKey])).toEqual([
      ["something nasty", true, undefined],
      ["and more", true, undefined],
    ]);
    expect(await bobStore.cursor(CHAT)).toBe(received.at(-1)!.seq);
  });
});
