import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromBase64, toBase64 } from "./e2ee";

/**
 * Backup v2: a person's MLS history, sealed under their history key, which lives in their backup
 * file and on their phones, never on the server. MLS can open a message only once, so this is what
 * brings history back on a new phone. It is not forward secret, and it's off unless the person
 * turns backup on. See "Key backup" in docs/mls-migration.md.
 */

export const HISTORY_KEY_LENGTH = 32;
const VERSION = 1;
const NONCE_LENGTH = 24;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

/** What history keeps of one message. The chat and `seq` are bound to it, not stored inside. */
export interface HistoryEntry {
  senderId: string;
  senderDeviceId: string;
  text: string;
  createdAt: number;
  /** Kept so a restored message can still be reported. */
  frankingKey?: Uint8Array;
  unverified?: boolean;
}

/** What the server keeps for one message: the chat, its place in the log, and the sealed entry. */
export interface SealedHistoryEntry {
  conversationId: string;
  seq: number;
  sealed: Uint8Array;
}

/**
 * Names a history key without revealing it, so a person's phones can tell whether they hold the
 * same one, and the server can refuse uploads under an old one.
 */
export function historyKeyId(key: Uint8Array): string {
  const label = encoder.encode("babillard-history-key-id-v1");
  const input = new Uint8Array(label.length + key.length);
  input.set(label);
  input.set(key, label.length);
  return toBase64(sha256(input));
}

/** The person, the chat and the place in its log, so the server can't move an entry. */
function associatedData(userId: string, conversationId: string, seq: number): Uint8Array {
  const parts = ["babillard-history-v1", userId, conversationId, String(seq)].map((part) => encoder.encode(part));
  const out = new Uint8Array(parts.reduce((total, part) => total + 4 + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    new DataView(out.buffer).setUint32(offset, part.length);
    out.set(part, offset + 4);
    offset += 4 + part.length;
  }
  return out;
}

/** A version byte, the nonce, then the entry under XChaCha20-Poly1305. */
export function sealHistoryEntry(key: Uint8Array, userId: string, conversationId: string, seq: number, entry: HistoryEntry, random: (length: number) => Uint8Array): Uint8Array {
  if (key.length !== HISTORY_KEY_LENGTH) throw new Error("A history key is 32 bytes");
  const plain = encoder.encode(
    JSON.stringify({
      senderId: entry.senderId,
      senderDeviceId: entry.senderDeviceId,
      text: entry.text,
      createdAt: entry.createdAt,
      frankingKey: entry.frankingKey ? toBase64(entry.frankingKey) : null,
      unverified: entry.unverified === true,
    }),
  );
  const nonce = random(NONCE_LENGTH);
  const ciphertext = xchacha20poly1305(key, nonce, associatedData(userId, conversationId, seq)).encrypt(plain);
  const out = new Uint8Array(1 + NONCE_LENGTH + ciphertext.length);
  out[0] = VERSION;
  out.set(nonce, 1);
  out.set(ciphertext, 1 + NONCE_LENGTH);
  return out;
}

/** The entry, or null if the key, the place, or the bytes are wrong. */
export function openHistoryEntry(key: Uint8Array, userId: string, conversationId: string, seq: number, sealed: Uint8Array): HistoryEntry | null {
  if (sealed.length < 1 + NONCE_LENGTH || sealed[0] !== VERSION) return null;
  try {
    const plain = xchacha20poly1305(key, sealed.subarray(1, 1 + NONCE_LENGTH), associatedData(userId, conversationId, seq)).decrypt(sealed.subarray(1 + NONCE_LENGTH));
    const parsed = JSON.parse(decoder.decode(plain)) as { senderId: string; senderDeviceId: string; text: string; createdAt: number; frankingKey: string | null; unverified: boolean };
    return {
      senderId: parsed.senderId,
      senderDeviceId: parsed.senderDeviceId,
      text: parsed.text,
      createdAt: parsed.createdAt,
      ...(parsed.frankingKey ? { frankingKey: fromBase64(parsed.frankingKey) } : {}),
      ...(parsed.unverified ? { unverified: true } : {}),
    };
  } catch {
    return null;
  }
}
