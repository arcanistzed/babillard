import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { fromBase64, toBase64 } from "../src/e2ee";
import { SqlMlsStore, type SqlDb } from "../src/mlsSqlStore";

/**
 * What the engine does in JavaScript for each message it receives, at the state sizes the Rust test
 * `measure_state` reports for 1, 10 and 50 chats: open the sealed state, send it to the native module
 * as base64 and read the answer back, then open it again, seal the new one and write it. Skipped
 * unless asked for: MEASURE_MLS_STATE=1 npx vitest run test/mlsStateCost.test.ts --disable-console-intercept
 */

const random = (length: number) => new Uint8Array(randomBytes(length));

function fileDb(path: string): SqlDb {
  const database = new DatabaseSync(path);
  const db: SqlDb = {
    async exec(sql) {
      database.exec(sql);
    },
    async run(sql, params) {
      database.prepare(sql).run(...params);
    },
    async all<T>(sql: string, params: (string | number | null | Uint8Array)[]) {
      return database.prepare(sql).all(...params) as T[];
    },
    async transaction(task) {
      database.exec("BEGIN IMMEDIATE");
      try {
        await task(db);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return db;
}

it.skipIf(!process.env.MEASURE_MLS_STATE)("measures the JavaScript side of one received message", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "mls-state-cost-"));
  try {
    for (const [chats, size] of [[1, 33_519], [10, 118_785], [50, 498_824]] as const) {
      const store = new SqlMlsStore(fileDb(join(dir, `${chats}.db`)), random(32), random);
      await store.apply({ device: { userId: "me", deviceId: "me-phone", state: random(size), signatureKey: random(32), registered: true } });
      const totals: number[] = [];
      const parts = { open: [] as number[], base64: [] as number[], save: [] as number[] };
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now();
        const loaded = (await store.loadDevice())!;
        const t1 = performance.now();
        const back = fromBase64(toBase64(loaded.state));
        const t2 = performance.now();
        const again = (await store.loadDevice())!;
        const message = { conversationId: "chat-0", id: String(i), seq: i, senderId: "a", senderDeviceId: "a-phone", text: "are you coming?", createdAt: i, status: "sent" as const };
        await store.apply({ device: { ...again, state: back }, cursors: { "chat-0": i }, messages: [message] });
        const t3 = performance.now();
        if (i < 10) continue;
        totals.push(t3 - t0);
        parts.open.push(t1 - t0);
        parts.base64.push(t2 - t1);
        parts.save.push(t3 - t2);
      }
      const median = (samples: number[]) => [...samples].sort((a, b) => a - b)[samples.length >> 1]!.toFixed(2);
      console.log(`chats=${chats} state=${size} bytes total=${median(totals)} ms open=${median(parts.open)} base64=${median(parts.base64)} reopen+seal+write=${median(parts.save)}`);
      expect(totals.length).toBe(50);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
