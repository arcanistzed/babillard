import { readFrame, type Frame } from "./group";

/**
 * The server's half of MLS: it can't read anything, but it decides the order.
 * Each chat's ChatRoom Durable Object would keep one epoch counter and call
 * `admit` for every incoming group message. Only one commit per epoch gets in,
 * and everyone applies commits in the order the log holds them.
 *
 * The check and the insert must run in the same synchronous block. A Durable
 * Object can take other requests while it awaits D1, so it must not await
 * between reading the epoch and writing the row.
 */

export type Admission =
  | { ok: true; frame: Frame; nextEpoch: number }
  | { ok: false; error: "not_mls" | "wrong_group" | "stale_epoch" | "proposals_not_supported"; epoch: number };

export function admit(conversationId: string, epoch: number, bytes: Uint8Array): Admission {
  const frame = readFrame(bytes);
  if (!frame) return { ok: false, error: "not_mls", epoch };
  if (frame.groupId !== conversationId) return { ok: false, error: "wrong_group", epoch };
  // Proposals ride inside commits. A lone proposal would need the server to track pending ones.
  if (frame.kind === "proposal") return { ok: false, error: "proposals_not_supported", epoch };
  // A sender behind on commits gets refused, catches up from the log, and sends again, like today's stale_keys.
  if (frame.epoch !== epoch) return { ok: false, error: "stale_epoch", epoch };
  return { ok: true, frame, nextEpoch: frame.kind === "commit" ? epoch + 1 : epoch };
}

export interface LogEntry {
  seq: number;
  kind: Frame["kind"];
  epoch: number;
  bytes: Uint8Array;
}

/** An in-memory stand-in for the Durable Object's tables, for tests and the dev screen. */
export class MemoryDeliveryService {
  epoch = 0;
  readonly log: LogEntry[] = [];
  /** Welcomes wait here until the new phone fetches them, keyed by its device ID. It reads the log from `seq` on. */
  readonly welcomes = new Map<string, { bytes: Uint8Array; seq: number }>();

  constructor(readonly conversationId: string) {}

  /** A commit and its Welcome are accepted together or not at all. */
  submit(bytes: Uint8Array, welcome?: { deviceIds: string[]; bytes: Uint8Array }): Admission {
    const result = admit(this.conversationId, this.epoch, bytes);
    if (!result.ok) return result;
    const seq = this.log.length + 1;
    this.log.push({ seq, kind: result.frame.kind, epoch: result.frame.epoch, bytes });
    this.epoch = result.nextEpoch;
    for (const deviceId of welcome?.deviceIds ?? []) this.welcomes.set(deviceId, { bytes: welcome!.bytes, seq });
    return result;
  }

  since(seq: number): LogEntry[] {
    return this.log.filter((entry) => entry.seq > seq);
  }
}
