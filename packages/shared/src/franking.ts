import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Message franking, so a report from an MLS chat can show a moderator what was really sent.
 *
 * The sender picks a random key for each message and sends it inside the encrypted message with the
 * text. Outside the encryption, in MLS's authenticated data, goes a commitment: an HMAC of the chat,
 * the sender and the text under that key. MLS binds the commitment to the message, and the server
 * keeps the message as it arrived from the sender's own session. A reporter later reveals the text
 * and the key, and the server checks them against the commitment it stored. Nothing else becomes
 * readable.
 */

const VERSION = 1;
export const FRANKING_KEY_LENGTH = 32;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

/** What goes inside the encryption: a version byte, the franking key, then the text. */
export function encodeFrankedPayload(text: string, frankingKey: Uint8Array): Uint8Array {
  if (frankingKey.length !== FRANKING_KEY_LENGTH) throw new Error("A franking key is 32 bytes");
  const body = encoder.encode(text);
  const out = new Uint8Array(1 + FRANKING_KEY_LENGTH + body.length);
  out[0] = VERSION;
  out.set(frankingKey, 1);
  out.set(body, 1 + FRANKING_KEY_LENGTH);
  return out;
}

/** The text and franking key from a payload, or null if it isn't one this version writes. */
export function decodeFrankedPayload(payload: Uint8Array): { text: string; frankingKey: Uint8Array } | null {
  if (payload.length < 1 + FRANKING_KEY_LENGTH || payload[0] !== VERSION) return null;
  try {
    return { frankingKey: payload.slice(1, 1 + FRANKING_KEY_LENGTH), text: decoder.decode(payload.subarray(1 + FRANKING_KEY_LENGTH)) };
  } catch {
    return null;
  }
}

/** Each input with a 4-byte length in front, so no two different inputs can produce the same bytes. */
function framed(...parts: string[]): Uint8Array {
  const encoded = parts.map((part) => encoder.encode(part));
  const out = new Uint8Array(encoded.reduce((sum, part) => sum + 4 + part.length, 0));
  let offset = 0;
  for (const part of encoded) {
    new DataView(out.buffer).setUint32(offset, part.length);
    out.set(part, offset + 4);
    offset += 4 + part.length;
  }
  return out;
}

/** What goes in MLS's authenticated data: a version byte, then the HMAC. */
export function frankingCommitment(frankingKey: Uint8Array, conversationId: string, senderId: string, text: string): Uint8Array {
  const tag = hmac(sha256, frankingKey, framed("babillard-franking-v1", conversationId, senderId, text));
  const out = new Uint8Array(1 + tag.length);
  out[0] = VERSION;
  out.set(tag, 1);
  return out;
}

/** Whether a commitment matches this text from this sender in this chat, under this key. */
export function checkFranking(commitment: Uint8Array, frankingKey: Uint8Array, conversationId: string, senderId: string, text: string): boolean {
  if (frankingKey.length !== FRANKING_KEY_LENGTH) return false;
  const expected = frankingCommitment(frankingKey, conversationId, senderId, text);
  if (commitment.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i]! ^ commitment[i]!;
  return difference === 0;
}
