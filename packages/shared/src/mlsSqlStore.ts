import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import type { MlsChange, MlsDeviceRecord, MlsPendingCommit, MlsStore, MlsStoredMessage } from "./mlsClient";

/**
 * The sync engine's storage on SQLite, encrypted at rest. The phone runs it on
 * expo-sqlite and the tests on Node's built-in SQLite, through `SqlDb`.
 *
 * - The MLS state holds every private key the phone has, and message text is the
 *   one place plaintext lives. Both are sealed with XChaCha20-Poly1305 under a
 *   32-byte key the caller keeps somewhere safer (SecureStore on the phone).
 *   Each value is bound to where it belongs, so rows can't be swapped around.
 * - `apply` runs in one exclusive transaction. Either the new state, the
 *   cursor and the text all land, or none do. That is what makes it safe for the
 *   app to be killed at any moment.
 */

export type SqlValue = string | number | null | Uint8Array;

export interface SqlDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params: SqlValue[]): Promise<void>;
  all<T>(sql: string, params: SqlValue[]): Promise<T[]>;
  /** Runs `task` in an exclusive transaction, using the handle it's given for every statement. */
  transaction(task: (tx: SqlDb) => Promise<void>): Promise<void>;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS mls_device (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    registered INTEGER NOT NULL,
    signature_key BLOB NOT NULL,
    state BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mls_cursors (conversation_id TEXT PRIMARY KEY, seq INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS mls_messages (
    conversation_id TEXT NOT NULL,
    id TEXT NOT NULL,
    seq INTEGER,
    sender_id TEXT NOT NULL,
    sender_device_id TEXT NOT NULL,
    text BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    ciphertext BLOB,
    client_id TEXT,
    PRIMARY KEY (conversation_id, id)
  );
  CREATE INDEX IF NOT EXISTS mls_messages_order ON mls_messages (conversation_id, seq);
  CREATE TABLE IF NOT EXISTS mls_pending_commits (conversation_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL, commit_message BLOB NOT NULL, state BLOB NOT NULL);
`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface DeviceRow {
  user_id: string;
  device_id: string;
  registered: number;
  signature_key: Uint8Array;
  state: Uint8Array;
}

interface MessageRow {
  conversation_id: string;
  id: string;
  seq: number | null;
  sender_id: string;
  sender_device_id: string;
  text: Uint8Array;
  created_at: number;
  status: string;
  ciphertext: Uint8Array | null;
  client_id: string | null;
}

export class SqlMlsStore implements MlsStore {
  private ready: Promise<void> | null = null;

  /** `key` is 32 random bytes kept outside the database. `random` fills nonces. */
  constructor(
    private readonly db: SqlDb,
    private readonly key: Uint8Array,
    private readonly random: (length: number) => Uint8Array,
  ) {
    if (key.length !== 32) throw new Error("The store key must be 32 bytes");
  }

  private init(): Promise<void> {
    this.ready ??= this.db.exec(SCHEMA);
    return this.ready;
  }

  private seal(plain: Uint8Array, context: string): Uint8Array {
    const nonce = this.random(24);
    const sealed = xchacha20poly1305(this.key, nonce, encoder.encode(context)).encrypt(plain);
    const out = new Uint8Array(24 + sealed.length);
    out.set(nonce);
    out.set(sealed, 24);
    return out;
  }

  private open(sealed: Uint8Array, context: string): Uint8Array {
    return xchacha20poly1305(this.key, sealed.subarray(0, 24), encoder.encode(context)).decrypt(sealed.subarray(24));
  }

  async loadDevice(): Promise<MlsDeviceRecord | null> {
    await this.init();
    const [row] = await this.db.all<DeviceRow>("SELECT * FROM mls_device WHERE id = 1", []);
    if (!row) return null;
    return {
      userId: row.user_id,
      deviceId: row.device_id,
      registered: row.registered === 1,
      signatureKey: new Uint8Array(row.signature_key),
      state: this.open(new Uint8Array(row.state), `mls-state:${row.device_id}`),
    };
  }

  async cursor(conversationId: string): Promise<number> {
    await this.init();
    const [row] = await this.db.all<{ seq: number }>("SELECT seq FROM mls_cursors WHERE conversation_id = ?", [conversationId]);
    return row?.seq ?? 0;
  }

  async messages(conversationId: string): Promise<MlsStoredMessage[]> {
    await this.init();
    const rows = await this.db.all<MessageRow>("SELECT * FROM mls_messages WHERE conversation_id = ? ORDER BY seq IS NULL, seq, created_at", [conversationId]);
    return rows.map((row) => ({
      conversationId: row.conversation_id,
      id: row.id,
      seq: row.seq,
      senderId: row.sender_id,
      senderDeviceId: row.sender_device_id,
      text: decoder.decode(this.open(new Uint8Array(row.text), `mls-text:${row.conversation_id}:${row.id}`)),
      createdAt: row.created_at,
      status: row.status as MlsStoredMessage["status"],
      ...(row.ciphertext ? { ciphertext: new Uint8Array(row.ciphertext) } : {}),
      ...(row.client_id ? { clientId: row.client_id } : {}),
    }));
  }

  async conversationIds(): Promise<string[]> {
    await this.init();
    const rows = await this.db.all<{ id: string }>(
      "SELECT conversation_id AS id FROM mls_cursors UNION SELECT conversation_id FROM mls_messages UNION SELECT conversation_id FROM mls_pending_commits",
      [],
    );
    return rows.map((row) => row.id);
  }

  async pendingCommits(): Promise<Record<string, MlsPendingCommit>> {
    await this.init();
    const rows = await this.db.all<{ conversation_id: string; epoch: number; commit_message: Uint8Array; state: Uint8Array }>("SELECT * FROM mls_pending_commits", []);
    return Object.fromEntries(
      rows.map((row) => [
        row.conversation_id,
        { epoch: row.epoch, commit: new Uint8Array(row.commit_message), state: this.open(new Uint8Array(row.state), `mls-pending:${row.conversation_id}`) },
      ]),
    );
  }

  async apply(change: MlsChange): Promise<void> {
    await this.init();
    // Seal outside the transaction, so it holds the lock only for the writes.
    const device = change.device;
    const state = device ? this.seal(device.state, `mls-state:${device.deviceId}`) : null;
    const messages = (change.messages ?? []).map((m) => ({ m, text: this.seal(encoder.encode(m.text), `mls-text:${m.conversationId}:${m.id}`) }));
    const pending = Object.entries(change.pendingCommits ?? {}).map(([conversationId, commit]) => ({
      conversationId,
      commit,
      state: commit ? this.seal(commit.state, `mls-pending:${conversationId}`) : null,
    }));
    await this.db.transaction(async (tx) => {
      if (device && state) {
        await tx.run("INSERT OR REPLACE INTO mls_device (id, user_id, device_id, registered, signature_key, state) VALUES (1, ?, ?, ?, ?, ?)", [
          device.userId,
          device.deviceId,
          device.registered ? 1 : 0,
          device.signatureKey,
          state,
        ]);
      }
      for (const { conversationId, commit, state: sealed } of pending) {
        if (commit && sealed) {
          await tx.run("INSERT OR REPLACE INTO mls_pending_commits (conversation_id, epoch, commit_message, state) VALUES (?, ?, ?, ?)", [conversationId, commit.epoch, commit.commit, sealed]);
        } else {
          await tx.run("DELETE FROM mls_pending_commits WHERE conversation_id = ?", [conversationId]);
        }
      }
      for (const [conversationId, seq] of Object.entries(change.cursors ?? {})) {
        await tx.run("INSERT OR REPLACE INTO mls_cursors (conversation_id, seq) VALUES (?, ?)", [conversationId, seq]);
      }
      for (const { conversationId, id } of change.deleteMessages ?? []) {
        await tx.run("DELETE FROM mls_messages WHERE conversation_id = ? AND id = ?", [conversationId, id]);
      }
      for (const conversationId of change.forgetChats ?? []) {
        await tx.run("DELETE FROM mls_messages WHERE conversation_id = ?", [conversationId]);
        await tx.run("DELETE FROM mls_cursors WHERE conversation_id = ?", [conversationId]);
        await tx.run("DELETE FROM mls_pending_commits WHERE conversation_id = ?", [conversationId]);
      }
      for (const { m, text } of messages) {
        await tx.run(
          "INSERT OR REPLACE INTO mls_messages (conversation_id, id, seq, sender_id, sender_device_id, text, created_at, status, ciphertext, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [m.conversationId, m.id, m.seq, m.senderId, m.senderDeviceId, text, m.createdAt, m.status, m.ciphertext ?? null, m.clientId ?? null],
        );
      }
    });
  }
}
