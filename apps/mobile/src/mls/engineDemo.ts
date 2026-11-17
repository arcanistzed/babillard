import { SqlMlsStore, runEngineDemo, type EngineDemoResult } from "@babillard/shared";
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
  const run = Date.now().toString(36);
  const opened: { db: SQLite.SQLiteDatabase; name: string }[] = [];
  try {
    return await runEngineDemo(
      nativeCrypto,
      async (person) => {
        const name = `babillard-mls-demo-${run}-${person}.db`;
        const db = await SQLite.openDatabaseAsync(name);
        opened.push({ db, name });
        return new SqlMlsStore(expoSqlDb(db), Crypto.getRandomBytes(32), (length) => Crypto.getRandomBytes(length));
      },
      () => performance.now(),
    );
  } finally {
    for (const { db, name } of opened) {
      await db.closeAsync().catch(() => undefined);
      await SQLite.deleteDatabaseAsync(name).catch(() => undefined);
    }
  }
}
