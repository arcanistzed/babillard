import { HISTORY_KEY_LENGTH, MlsMessenger, SqlMlsStore, fromBase64, holdsMlsGroup, httpMlsTransport, toBase64, type HttpCall, type SqlDb } from "@babillard/shared";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import { isAvailable } from "../../modules/babillard-mls";
import { ApiError, request } from "../api";
import { ensureDeviceKey } from "../e2ee";
import { nativeCrypto } from "./nativeCrypto";

/**
 * MLS on the phone: the shared sync engine, on OpenMLS through the native
 * module, storing into an encrypted SQLite database. The database key lives in
 * SecureStore, so the database file alone opens nothing.
 *
 * Off unless the server carries MLS chats (`me.mls`, set from MLS_ENABLED) and the native library
 * loaded. Until then the app makes no MLS request and opens no MLS database, so a release can ship
 * with MLS dormant and the server can switch it on later.
 */

const random = (length: number) => Crypto.getRandomBytes(length);
const keyName = (userId: string) => `babillard.mls-store-key.${userId}`;
const historyKeyName = (userId: string) => `babillard.mls-history-key.${userId}`;
const databaseName = (userId: string) => `babillard-mls-${userId}.db`;

/** Backup v2: the person's history key on this phone, if they back up history. It also goes in their backup file. */
export async function storedHistoryKey(userId: string): Promise<Uint8Array | null> {
  const stored = await SecureStore.getItemAsync(historyKeyName(userId));
  return stored ? fromBase64(stored) : null;
}

export async function storeHistoryKey(userId: string, key: Uint8Array | null): Promise<void> {
  if (key) await SecureStore.setItemAsync(historyKeyName(userId), toBase64(key));
  else await SecureStore.deleteItemAsync(historyKeyName(userId));
}

/** A new history key, for someone turning backup of history on. */
export function newHistoryKey(): Uint8Array {
  return random(HISTORY_KEY_LENGTH);
}

/** expo-sqlite behind the store's SQL interface. Statements inside a transaction use its own handle. */
export function expoSqlDb(db: SQLite.SQLiteDatabase): SqlDb {
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params) => {
      await db.runAsync(sql, params);
    },
    all: (sql, params) => db.getAllAsync(sql, params),
    transaction: (task) => db.withExclusiveTransactionAsync((txn) => task(expoSqlDb(txn))),
  };
}

/** The 32-byte key the database is sealed with, created on first use. */
export async function storeKey(userId: string): Promise<Uint8Array> {
  const stored = await SecureStore.getItemAsync(keyName(userId));
  if (stored) return fromBase64(stored);
  const key = random(32);
  await SecureStore.setItemAsync(keyName(userId), toBase64(key));
  return key;
}

/** The engine's view of the API: errors come back as statuses, and only a network failure throws. */
const call: HttpCall = async (method, path, body) => {
  try {
    return { status: 200, body: await request(method, path, body) };
  } catch (error) {
    if (error instanceof ApiError && error.status > 0) return { status: error.status, body: { error: error.code } };
    throw error;
  }
};

let current: { userId: string; messenger: Promise<MlsMessenger> } | null = null;
/** The open messenger's store, so the downgrade guard can ask it without a second connection. */
let currentStore: { userId: string; store: SqlMlsStore } | null = null;

async function open(userId: string): Promise<MlsMessenger> {
  const device = await ensureDeviceKey(userId);
  const db = await SQLite.openDatabaseAsync(databaseName(userId));
  const store = new SqlMlsStore(expoSqlDb(db), await storeKey(userId), random);
  currentStore = { userId, store };
  const messenger = new MlsMessenger(nativeCrypto, httpMlsTransport(call), store, { userId, deviceId: device.publicKey });
  await messenger.ensureIdentity();
  const historyKey = await storedHistoryKey(userId);
  if (historyKey) {
    // Another of the person's phones may have started over with a new key. Then this one's is no use.
    const current = await messenger.useHistoryKey(historyKey).catch(() => true);
    if (!current) await storeHistoryKey(userId, null);
  }
  return messenger;
}

/** Who's signed in, as far as MLS cares: `mls` is the server's word that MLS is on. */
export interface MlsUser {
  id: string;
  mls?: boolean;
}

/** This phone's MLS messenger, or null when MLS is off here. A failure is forgotten, so the next call tries again. */
export function mlsMessenger(me: MlsUser | null | undefined): Promise<MlsMessenger> | null {
  if (!me?.mls || !isAvailable) return null;
  const userId = me.id;
  if (current?.userId !== userId) {
    const messenger = open(userId);
    current = { userId, messenger };
    messenger.catch(() => {
      if (current?.messenger === messenger) current = null;
    });
  }
  return current.messenger;
}

/**
 * The downgrade guard's question, asked whatever `/me` says: does this phone hold an MLS group for
 * this chat, or a commit that may have moved it? If so, the chat must never get v1 from here.
 *
 * It creates nothing and asks the server nothing. The database key is made the first time MLS opens,
 * so with no key there's no database and no group, and it stops there without opening anything.
 * With a key, it opens the database just to read it, never through `open()`, which registers.
 * A key whose database won't open counts as holding a group: the guard fails closed.
 */
export async function holdsMlsGroupHere(userId: string, conversationId: string): Promise<boolean> {
  if (!isAvailable) return false;
  if (currentStore?.userId === userId) return holdsMlsGroup(currentStore.store, nativeCrypto, conversationId).catch(() => true);
  try {
    const key = await SecureStore.getItemAsync(keyName(userId));
    if (!key) return false;
    const db = await SQLite.openDatabaseAsync(databaseName(userId));
    try {
      return await holdsMlsGroup(new SqlMlsStore(expoSqlDb(db), fromBase64(key), random), nativeCrypto, conversationId);
    } finally {
      await db.closeAsync().catch(() => undefined);
    }
  } catch (error) {
    console.warn("Couldn't check this phone's MLS groups, so v1 stays off for this chat", error);
    return true;
  }
}

/** Deleting the account removes the database and its key, which makes anything left in it unreadable. */
export async function deleteMlsData(userId: string): Promise<void> {
  current = null;
  currentStore = null;
  await SecureStore.deleteItemAsync(keyName(userId));
  await SecureStore.deleteItemAsync(historyKeyName(userId));
  await SQLite.deleteDatabaseAsync(databaseName(userId)).catch(() => undefined);
}
