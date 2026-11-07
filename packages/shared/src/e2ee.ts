import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * End-to-end encryption for chat messages.
 *
 * Each phone has an X25519 key pair, and the private half never leaves it. Each
 * message gets a fresh random key that encrypts the text. That key is then
 * encrypted once per device in the chat, using a key shared between the sender's
 * device and that device. Because every message names its own readers, a group
 * needs no shared key to rotate: someone who joins can read from then on, and
 * someone who leaves stops being included.
 *
 * Known limits, also stated in the README: a stolen device key opens all of that
 * device's past messages, since keys don't ratchet. The server hands out public
 * keys, so only comparing security codes can detect it adding a device of its own.
 */

export interface DeviceKey {
  secretKey: Uint8Array;
  /** Also serves as the device's ID. */
  publicKey: string;
}

export interface Envelope {
  v: 1;
  /** The sending device's public key. */
  from: string;
  nonce: string;
  ciphertext: string;
  /** The message key, encrypted for each device that may read it. */
  keys: Record<string, { nonce: string; key: string }>;
}

export interface OpenedMessage {
  text: string;
  /** Lets a reporter prove to moderators what this message said, without revealing anything else. */
  contentKey: string;
}

type Random = (length: number) => Uint8Array;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Hand-written because Hermes has no Buffer, and its btoa handles only some inputs. */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    out += BASE64URL[a >> 2]!;
    out += BASE64URL[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) out += BASE64URL[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) out += BASE64URL[c & 63]!;
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of text) {
    const value = BASE64URL.indexOf(char);
    if (value < 0) throw new Error("Invalid base64");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 255;
      buffer &= (1 << bits) - 1;
    }
  }
  return out;
}

export function deviceKeyFromSecret(secretKey: Uint8Array): DeviceKey {
  return { secretKey, publicKey: toBase64(x25519.getPublicKey(secretKey)) };
}

export function generateDeviceKey(random: Random): DeviceKey {
  return deviceKeyFromSecret(random(32));
}

// X25519 is the slow step in pure JavaScript, and a chat involves few pairs of devices.
const pairKeys = new Map<string, Uint8Array>();

export function forgetPairKeys(): void {
  pairKeys.clear();
}

function pairKey(me: DeviceKey, theirPublicKey: string): Uint8Array {
  const id = `${me.publicKey}:${theirPublicKey}`;
  const cached = pairKeys.get(id);
  if (cached) return cached;
  const shared = x25519.getSharedSecret(me.secretKey, fromBase64(theirPublicKey));
  const [first, second] = [me.publicKey, theirPublicKey].sort() as [string, string];
  const key = hkdf(sha256, shared, encoder.encode(`${first}:${second}`), encoder.encode("ideas-match/v1/pair"), 32);
  pairKeys.set(id, key);
  return key;
}

// Tying each message to its chat and sender stops a server from moving it to another chat or crediting someone else.
const messageContext = (conversationId: string, senderId: string) => encoder.encode(`ideas-match/v1/message:${conversationId}:${senderId}`);
const wrapContext = (conversationId: string, senderId: string, reader: string) => encoder.encode(`ideas-match/v1/wrap:${conversationId}:${senderId}:${reader}`);

export function sealMessage(input: { text: string; conversationId: string; senderId: string; sender: DeviceKey; readers: string[]; random: Random }): Envelope {
  const { text, conversationId, senderId, sender, readers, random } = input;
  const contentKey = random(32);
  const nonce = random(24);
  const ciphertext = xchacha20poly1305(contentKey, nonce, messageContext(conversationId, senderId)).encrypt(encoder.encode(text));
  const keys: Envelope["keys"] = {};
  for (const reader of new Set(readers)) {
    const wrapNonce = random(24);
    const wrapped = xchacha20poly1305(pairKey(sender, reader), wrapNonce, wrapContext(conversationId, senderId, reader)).encrypt(contentKey);
    keys[reader] = { nonce: toBase64(wrapNonce), key: toBase64(wrapped) };
  }
  return { v: 1, from: sender.publicKey, nonce: toBase64(nonce), ciphertext: toBase64(ciphertext), keys };
}

/** Decrypts with a message key alone. Moderation uses this to check that reported text really matches what was stored. */
export function openWithContentKey(envelope: Envelope, conversationId: string, senderId: string, contentKey: string): string | null {
  try {
    const plain = xchacha20poly1305(fromBase64(contentKey), fromBase64(envelope.nonce), messageContext(conversationId, senderId)).decrypt(fromBase64(envelope.ciphertext));
    return decoder.decode(plain);
  } catch {
    return null;
  }
}

/** Returns null if this device wasn't a reader, the message was altered, or it came from a key the sender doesn't have. */
export function openMessage(input: { envelope: Envelope; conversationId: string; senderId: string; me: DeviceKey; senderKeys?: string[] }): OpenedMessage | null {
  const { envelope, conversationId, senderId, me, senderKeys } = input;
  const wrap = envelope.keys[me.publicKey];
  if (!wrap || (senderKeys && !senderKeys.includes(envelope.from))) return null;
  try {
    const contentKey = xchacha20poly1305(pairKey(me, envelope.from), fromBase64(wrap.nonce), wrapContext(conversationId, senderId, me.publicKey)).decrypt(fromBase64(wrap.key));
    const encoded = toBase64(contentKey);
    const text = openWithContentKey(envelope, conversationId, senderId, encoded);
    return text === null ? null : { text, contentKey: encoded };
  } catch {
    return null;
  }
}

/** Everyone in a chat sees the same code unless the server gave someone a different set of keys. */
export function securityCode(publicKeys: string[]): string {
  const digest = sha256(encoder.encode(["ideas-match/v1/code", ...[...publicKeys].sort()].join(":")));
  const groups: string[] = [];
  for (let i = 0; i < 12; i += 3) {
    const value = ((digest[i]! << 16) | (digest[i + 1]! << 8) | digest[i + 2]!) % 100000;
    groups.push(String(value).padStart(5, "0"));
  }
  return groups.join(" ");
}

const BACKUP_KDF = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 };

export interface KeyBackup {
  app: "ideas-match";
  v: 1;
  salt: string;
  nonce: string;
  ciphertext: string;
}

function backupKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  // The slow setting is the point: it makes guessing a passphrase from a stolen file expensive.
  return scryptAsync(encoder.encode(passphrase.normalize("NFKC")), salt, BACKUP_KDF);
}

/** Wraps private keys so that the file is useless without the passphrase, which is never stored or sent anywhere. */
export async function createKeyBackup(secretKeys: Uint8Array[], passphrase: string, random: Random): Promise<KeyBackup> {
  const [salt, nonce] = [random(16), random(24)];
  const key = await backupKey(passphrase, salt);
  const plain = encoder.encode(JSON.stringify(secretKeys.map(toBase64)));
  return { app: "ideas-match", v: 1, salt: toBase64(salt), nonce: toBase64(nonce), ciphertext: toBase64(xchacha20poly1305(key, nonce).encrypt(plain)) };
}

/** Returns null for a wrong passphrase or a file that isn't a backup. */
export async function openKeyBackup(text: string, passphrase: string): Promise<Uint8Array[] | null> {
  try {
    const backup = JSON.parse(text) as KeyBackup;
    if (backup.app !== "ideas-match" || backup.v !== 1) return null;
    const key = await backupKey(passphrase, fromBase64(backup.salt));
    const plain = xchacha20poly1305(key, fromBase64(backup.nonce)).decrypt(fromBase64(backup.ciphertext));
    return (JSON.parse(decoder.decode(plain)) as string[]).map(fromBase64);
  } catch {
    return null;
  }
}
