import { decide, fromBase64, pendingAdds, pendingRemovals, toBase64, type Decision, type Directory, type MlsGroupState, type MlsLogEntry, type RosterEntry } from "@babillard/shared";

/**
 * A chat's MLS state inside its ChatRoom Durable Object: the ordered log, the
 * server's copy of the roster, the current epoch, Welcomes waiting for new
 * phones, and the latest GroupInfo. Kept apart from the `messages` table, which
 * account deletion and block filtering edit. Nothing here may be edited out of
 * order, or members' copies of the group stop agreeing.
 *
 * `submit` is synchronous on purpose. A Durable Object can take other requests
 * while it awaits anything, so the epoch check and the insert must not be
 * separated by an await.
 */

interface LogRow extends Record<string, SqlStorageValue> {
  seq: number;
  epoch: number;
  kind: string;
  sender_id: string;
  device_id: string;
  message: ArrayBuffer;
  client_id: string | null;
  created_at: number;
}

const blob = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

function toEntry(row: LogRow): MlsLogEntry {
  return {
    seq: row.seq,
    epoch: row.epoch,
    kind: row.kind as MlsLogEntry["kind"],
    senderId: row.sender_id,
    deviceId: row.device_id,
    message: toBase64(new Uint8Array(row.message)),
    clientId: row.client_id,
    createdAt: row.created_at,
  };
}

export type SubmitResult = { ok: true; entry: MlsLogEntry; duplicate: boolean } | { ok: false; error: string; epoch: number };

export const CLAIMS_PER_WINDOW = 3;
export const CLAIM_WINDOW_MS = 10 * 60 * 1000;

export class MlsLog {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS mls_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        epoch INTEGER NOT NULL,
        kind TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        message BLOB NOT NULL,
        client_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS mls_log_client_idx ON mls_log (device_id, client_id) WHERE client_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS mls_roster (leaf_index INTEGER PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS mls_welcomes (device_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, welcome BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS mls_group_info (id INTEGER PRIMARY KEY CHECK (id = 1), epoch INTEGER NOT NULL, group_info BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS mls_admitted (device_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, signature_key TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mls_claims (device_id TEXT NOT NULL, claimed_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS mls_claims_device_idx ON mls_claims (device_id, claimed_at);
    `);
  }

  /**
   * Which of these phones may have a fresh single-use key package claimed for this chat now, and
   * records those claims. Each phone gets `CLAIMS_PER_WINDOW` in any `CLAIM_WINDOW_MS`, which covers
   * a lost race or two. Past that, a claim gets the phone's reusable last-resort package or nothing,
   * so a member who keeps claiming without adding anyone can't use up a newcomer's packages.
   */
  allowClaims(deviceIds: string[], now: number): string[] {
    const sql = this.storage.sql;
    sql.exec("DELETE FROM mls_claims WHERE claimed_at <= ?", now - CLAIM_WINDOW_MS);
    const allowed: string[] = [];
    for (const deviceId of new Set(deviceIds)) {
      const [row] = sql.exec<{ n: number }>("SELECT count(*) AS n FROM mls_claims WHERE device_id = ?", deviceId).toArray();
      if ((row?.n ?? 0) >= CLAIMS_PER_WINDOW) continue;
      sql.exec("INSERT INTO mls_claims (device_id, claimed_at) VALUES (?, ?)", deviceId, now);
      allowed.push(deviceId);
    }
    return allowed;
  }

  get epoch(): number {
    return this.storage.kv.get<number>("mls_epoch") ?? 0;
  }

  /** "mls" once the first commit is accepted. From then on the chat refuses v1 envelopes. */
  get mode(): "v1" | "mls" {
    return this.storage.kv.get<string>("mls_mode") === "mls" ? "mls" : "v1";
  }

  roster(): RosterEntry[] {
    return this.storage.sql
      .exec<{ leaf_index: number; user_id: string; device_id: string }>("SELECT * FROM mls_roster ORDER BY leaf_index")
      .toArray()
      .map((row) => ({ leafIndex: row.leaf_index, userId: row.user_id, deviceId: row.device_id }));
  }

  lastSeq(): number {
    return this.storage.sql.exec<{ seq: number | null }>("SELECT max(seq) AS seq FROM mls_log").one().seq ?? 0;
  }

  state(directory: Directory): MlsGroupState {
    const roster = this.roster();
    return {
      mode: this.mode,
      epoch: this.epoch,
      lastSeq: this.lastSeq(),
      roster,
      pendingAdds: pendingAdds(roster, directory),
      pendingRemovals: pendingRemovals(roster, directory),
      directory: [...directory].flatMap(([userId, devices]) => [...devices].map(([deviceId, signatureKey]) => ({ userId, deviceId, signatureKey }))),
      admitted: this.storage.sql
        .exec<{ device_id: string; user_id: string; signature_key: string }>("SELECT * FROM mls_admitted")
        .toArray()
        .map((row) => ({ userId: row.user_id, deviceId: row.device_id, signatureKey: row.signature_key })),
    };
  }

  submit(input: {
    conversationId: string;
    directory: Directory;
    memberIds: string[];
    newGroups: boolean;
    sender: { userId: string; deviceId: string };
    message: string;
    welcome?: string;
    groupInfo?: string;
    clientId?: string;
  }): SubmitResult {
    const sql = this.storage.sql;
    if (input.clientId) {
      const existing = sql.exec<LogRow>("SELECT * FROM mls_log WHERE device_id = ? AND client_id = ?", input.sender.deviceId, input.clientId).toArray()[0];
      if (existing) return { ok: true, entry: toEntry(existing), duplicate: true };
    }

    const message = fromBase64(input.message);
    const welcome = input.welcome ? fromBase64(input.welcome) : undefined;
    const groupInfo = input.groupInfo ? fromBase64(input.groupInfo) : undefined;
    const decision: Decision = decide({
      conversationId: input.conversationId,
      epoch: this.epoch,
      roster: this.roster(),
      directory: input.directory,
      memberIds: input.memberIds,
      newGroups: input.newGroups,
      sender: input.sender,
      message,
      ...(welcome ? { welcome } : {}),
      ...(groupInfo ? { groupInfo } : {}),
    });
    if (!decision.ok) return { ok: false, error: decision.error, epoch: decision.epoch };

    let row!: LogRow;
    this.storage.transactionSync(() => {
      row = sql
        .exec<LogRow>(
          "INSERT INTO mls_log (epoch, kind, sender_id, device_id, message, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
          decision.epoch,
          decision.kind,
          input.sender.userId,
          input.sender.deviceId,
          blob(message),
          input.clientId ?? null,
          Date.now(),
        )
        .one();
      if (decision.kind === "commit") {
        sql.exec("DELETE FROM mls_roster");
        for (const entry of decision.roster) {
          sql.exec("INSERT INTO mls_roster (leaf_index, user_id, device_id) VALUES (?, ?, ?)", entry.leafIndex, entry.userId, entry.deviceId);
          // Remembered for good: later phones will meet this one in the group's history.
          const signatureKey = input.directory.get(entry.userId)?.get(entry.deviceId);
          if (signatureKey) sql.exec("INSERT OR IGNORE INTO mls_admitted (device_id, user_id, signature_key) VALUES (?, ?, ?)", entry.deviceId, entry.userId, signatureKey);
        }
        for (const entry of decision.added) {
          sql.exec("INSERT OR REPLACE INTO mls_welcomes (device_id, seq, welcome) VALUES (?, ?, ?)", entry.deviceId, row.seq, blob(welcome!));
        }
        // A removed phone's waiting Welcome is no use to it any more.
        sql.exec("DELETE FROM mls_welcomes WHERE device_id NOT IN (SELECT device_id FROM mls_roster)");
        if (groupInfo) sql.exec("INSERT OR REPLACE INTO mls_group_info (id, epoch, group_info) VALUES (1, ?, ?)", decision.nextEpoch, blob(groupInfo));
        else sql.exec("DELETE FROM mls_group_info");
        this.storage.kv.put("mls_epoch", decision.nextEpoch);
        this.storage.kv.put("mls_mode", "mls");
      }
    });
    return { ok: true, entry: toEntry(row), duplicate: false };
  }

  since(seq: number, limit = 200): MlsLogEntry[] {
    return this.storage.sql
      .exec<LogRow>("SELECT * FROM mls_log WHERE seq > ? ORDER BY seq LIMIT ?", seq, Math.min(Math.max(limit, 1), 500))
      .toArray()
      .map(toEntry);
  }

  /** Particular entries, for checking a report against what was really sent. */
  entries(seqs: number[]): MlsLogEntry[] {
    const wanted = [...new Set(seqs)].slice(0, 50);
    if (!wanted.length) return [];
    return this.storage.sql
      .exec<LogRow>(`SELECT * FROM mls_log WHERE seq IN (${wanted.map(() => "?").join(", ")})`, ...wanted)
      .toArray()
      .map(toEntry);
  }

  welcome(deviceId: string): { seq: number; welcome: string } | null {
    const row = this.storage.sql.exec<{ seq: number; welcome: ArrayBuffer }>("SELECT seq, welcome FROM mls_welcomes WHERE device_id = ?", deviceId).toArray()[0];
    return row ? { seq: row.seq, welcome: toBase64(new Uint8Array(row.welcome)) } : null;
  }

  groupInfo(): { epoch: number; groupInfo: string } | null {
    const row = this.storage.sql.exec<{ epoch: number; group_info: ArrayBuffer }>("SELECT epoch, group_info FROM mls_group_info WHERE id = 1").toArray()[0];
    return row && row.epoch === this.epoch ? { epoch: row.epoch, groupInfo: toBase64(new Uint8Array(row.group_info)) } : null;
  }
}
