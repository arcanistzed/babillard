import {
  createKeyBackup,
  deviceKeyFromSecret,
  forgetPairKeys,
  fromBase64,
  generateDeviceKey,
  openKeyBackup,
  openMessage,
  sealMessage,
  toBase64,
  type ChatMessage,
  type ConversationMember,
  type DeviceKey,
  type Envelope,
} from "@ideas-match/shared";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { api } from "./api";

const storageName = (userId: string) => `ideas-match.device-key.${userId}`;
const restoredName = (userId: string) => `ideas-match.restored-keys.${userId}`;
const random = (length: number) => Crypto.getRandomBytes(length);

let current: { userId: string; key: Promise<DeviceKey> } | null = null;

async function loadOrCreate(userId: string): Promise<DeviceKey> {
  const stored = await SecureStore.getItemAsync(storageName(userId));
  const key = stored ? deviceKeyFromSecret(fromBase64(stored)) : generateDeviceKey(random);
  if (!stored) await SecureStore.setItemAsync(storageName(userId), toBase64(key.secretKey));
  await api.post("/me/device-key", { publicKey: key.publicKey });
  return key;
}

/** This phone's key, created and registered the first time it's needed. A failure is forgotten, so the next call tries again. */
export function ensureDeviceKey(userId: string): Promise<DeviceKey> {
  if (current?.userId !== userId) {
    const key = loadOrCreate(userId);
    current = { userId, key };
    key.catch(() => {
      if (current?.key === key) current = null;
    });
  }
  return current.key;
}

/** On sign-out the key stays on the phone, so signing back in keeps the history readable. */
export function forgetLoadedKey(): void {
  current = null;
  forgetPairKeys();
}

/** Deleting the account removes the key for good, which makes anything left unreadable. */
export async function deleteDeviceKey(userId: string): Promise<void> {
  forgetLoadedKey();
  await SecureStore.deleteItemAsync(storageName(userId));
  await SecureStore.deleteItemAsync(restoredName(userId));
}

export interface ReadableMessage extends ChatMessage {
  /** The app can't open this: it was sent before this phone signed in, or it failed its integrity check. */
  unreadable?: boolean;
  contentKey?: string;
}

function knownKeys(members: ConversationMember[] | undefined, senderId: string): string[] | undefined {
  const sender = members?.find((member) => member.id === senderId);
  return sender ? [...sender.deviceKeys, ...sender.retiredDeviceKeys] : undefined;
}

/** Keys brought back from a backup. They only open old messages. New messages use this phone's own key. */
async function restoredKeys(userId: string): Promise<DeviceKey[]> {
  const stored = await SecureStore.getItemAsync(restoredName(userId));
  return stored ? (JSON.parse(stored) as string[]).map((secret) => deviceKeyFromSecret(fromBase64(secret))) : [];
}

/** Every key this phone can read with, its own first. */
export async function readingKeys(userId: string): Promise<DeviceKey[]> {
  return [await ensureDeviceKey(userId), ...(await restoredKeys(userId))];
}

export async function saveBackupFile(userId: string, passphrase: string): Promise<string> {
  const keys = await readingKeys(userId);
  return JSON.stringify(await createKeyBackup(keys.map((key) => key.secretKey), passphrase, random));
}

/** False for a wrong passphrase. */
export async function restoreFromBackup(userId: string, fileText: string, passphrase: string): Promise<boolean> {
  const secrets = await openKeyBackup(fileText, passphrase);
  if (!secrets) return false;
  const current = await ensureDeviceKey(userId);
  const existing = await restoredKeys(userId);
  const known = new Set([current.publicKey, ...existing.map((key) => key.publicKey)]);
  const added = secrets.map(deviceKeyFromSecret).filter((key) => !known.has(key.publicKey));
  await SecureStore.setItemAsync(restoredName(userId), JSON.stringify([...existing, ...added].map((key) => toBase64(key.secretKey))));
  return true;
}

export function readMessage(message: ChatMessage, conversationId: string, keys: DeviceKey[], members?: ConversationMember[]): ReadableMessage {
  if (!message.envelope || !message.senderId) return message;
  for (const me of keys) {
    if (!message.envelope.keys[me.publicKey]) continue;
    const opened = openMessage({ envelope: message.envelope, conversationId, senderId: message.senderId, me, senderKeys: knownKeys(members, message.senderId) });
    if (opened) return { ...message, body: opened.text, contentKey: opened.contentKey };
  }
  return { ...message, unreadable: true };
}

export function sealFor(text: string, conversationId: string, senderId: string, me: DeviceKey, members: ConversationMember[]): Envelope {
  const readers = [me.publicKey, ...members.flatMap((member) => member.deviceKeys)];
  return sealMessage({ text, conversationId, senderId, sender: me, readers, random });
}
