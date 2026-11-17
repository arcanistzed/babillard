import { SqlMlsStore, runEngineDemo, runRecoveryDemo, type EngineDemoResult, type MlsStore, type RecoveryDemoResult } from "@babillard/shared";
import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import { expoSqlDb } from "./index";
import { nativeCrypto } from "./nativeCrypto";

/**
 * The full sync engine on this phone: OpenMLS through the native module, and a
 * real encrypted expo-sqlite database per simulated phone. The server is the
 * in-memory copy of its rules, so no accounts or network are involved. The
 * databases are throwaway and deleted afterwards.
 */
export async function runEngineOnPhone(): Promise<EngineDemoResult> {
  return withThrowawayStores((storeFor) => runEngineDemo(nativeCrypto, storeFor, () => performance.now()));
}

/** The engine's recovery cases on OpenMLS and expo-sqlite, against the same in-memory server. */
export async function runRecoveryOnPhone(): Promise<RecoveryDemoResult> {
  return withThrowawayStores((storeFor) => runRecoveryDemo(nativeCrypto, storeFor, () => performance.now()));
}

async function withThrowawayStores<T>(run: (storeFor: (person: string) => Promise<MlsStore>) => Promise<T>): Promise<T> {
  const id = Date.now().toString(36);
  const opened: { db: SQLite.SQLiteDatabase; name: string }[] = [];
  try {
    return await run(async (person) => {
      const name = `babillard-mls-demo-${id}-${person}.db`;
      const db = await SQLite.openDatabaseAsync(name);
      opened.push({ db, name });
      return new SqlMlsStore(expoSqlDb(db), Crypto.getRandomBytes(32), (length) => Crypto.getRandomBytes(length));
    });
  } finally {
    for (const { db, name } of opened) {
      await db.closeAsync().catch(() => undefined);
      await SQLite.deleteDatabaseAsync(name).catch(() => undefined);
    }
  }
}
