import { sha256 } from "@noble/hashes/sha2.js";
import type { MlsGroupState, MlsLogEntry } from "./api";
import { fromBase64, toBase64 } from "./e2ee";
import { MlsHttpError } from "./mlsTransport";

/**
 * The phone's side of MLS chat, independent of platform. It keeps a phone's
 * groups in step with the server's log, and does the chores the server asks for:
 * creating a chat's group, joining one, adding members' new phones, removing
 * departed ones, and keeping key packages topped up.
 *
 * It depends on three things it's given:
 * - `MlsCrypto`: OpenMLS through the native module on the phone, ts-mls in tests.
 *   Every call takes the whole state as bytes and returns new bytes, and a failed
 *   call changes nothing.
 * - `MlsTransport`: the server's /mls routes.
 * - `MlsStore`: durable storage, where each change is applied atomically.
 *
 * Rules it follows (see docs/mls-migration.md):
 * - One operation at a time. Every call goes through one queue, because the
 *   state is a single blob and two calls from the same bytes would lose one.
 * - New state is saved before anything derived from it leaves the phone.
 * - Never roll back after encrypting. A message that fails to send is resent
 *   with the same bytes. Only a refused commit is rolled back.
 * - Every credential is checked against the server's latest directory.
 */

export interface TrustedDevice {
  userId: string;
  deviceId: string;
  signatureKey: Uint8Array;
}

export interface MlsCommit {
  state: Uint8Array;
  commit: Uint8Array;
  welcome?: Uint8Array;
  groupInfo: Uint8Array;
}

export type MlsReceived =
  | { kind: "application"; state: Uint8Array; plaintext: Uint8Array; aad: Uint8Array; senderUserId?: string; senderDeviceId?: string }
  | { kind: "commit"; state: Uint8Array; removedMe: boolean };

export interface MlsCrypto {
  createIdentity(userId: string, deviceId: string): Promise<{ state: Uint8Array; keyPackage: Uint8Array; signatureKey: Uint8Array }>;
  createKeyPackage(state: Uint8Array): Promise<{ state: Uint8Array; keyPackage: Uint8Array }>;
  createGroup(state: Uint8Array, conversationId: string): Promise<Uint8Array>;
  addMembers(state: Uint8Array, conversationId: string, keyPackages: Uint8Array[], trusted: TrustedDevice[]): Promise<MlsCommit>;
  removeLeaves(state: Uint8Array, conversationId: string, leafIndexes: number[]): Promise<MlsCommit>;
  updateKeys(state: Uint8Array, conversationId: string): Promise<MlsCommit>;
  joinFromWelcome(state: Uint8Array, welcome: Uint8Array, trusted: TrustedDevice[]): Promise<{ state: Uint8Array; conversationId: string }>;
  joinExternal(state: Uint8Array, groupInfo: Uint8Array, trusted: TrustedDevice[]): Promise<MlsCommit & { conversationId: string }>;
  encrypt(state: Uint8Array, conversationId: string, plaintext: Uint8Array, aad: Uint8Array): Promise<{ state: Uint8Array; message: Uint8Array }>;
  receive(state: Uint8Array, conversationId: string, message: Uint8Array, trusted: TrustedDevice[]): Promise<MlsReceived>;
  /** Null if this phone has no group for the chat. */
  groupStatus(state: Uint8Array, conversationId: string): Promise<{ epoch: number; roster: { leafIndex: number; userId: string; deviceId: string; signatureKey: Uint8Array }[] } | null>;
}

export type SubmitResult = { ok: true; entry: MlsLogEntry } | { ok: false; error: string; status: number };

export interface MlsTransport {
  registerIdentity(deviceId: string, signatureKey: Uint8Array): Promise<void>;
  uploadKeyPackages(deviceId: string, keyPackages: Uint8Array[]): Promise<void>;
  keyPackageCount(deviceId: string): Promise<number>;
  claimKeyPackages(conversationId: string, deviceIds: string[]): Promise<{ deviceId: string; keyPackage: Uint8Array }[]>;
  groupState(conversationId: string): Promise<MlsGroupState>;
  submit(conversationId: string, body: { deviceId: string; message: Uint8Array; welcome?: Uint8Array; groupInfo?: Uint8Array; clientId?: string }): Promise<SubmitResult>;
  log(conversationId: string, since: number): Promise<MlsLogEntry[]>;
  welcome(conversationId: string, deviceId: string): Promise<{ seq: number; welcome: Uint8Array } | null>;
  groupInfo(conversationId: string): Promise<Uint8Array | null>;
}

export interface MlsStoredMessage {
  conversationId: string;
  /** The log's `seq` once the server has it, or a local ID for one still sending. */
  id: string;
  seq: number | null;
  senderId: string;
  senderDeviceId: string;
  text: string;
  createdAt: number;
  /** "failed" means it can't be resent as is. The text stays, for the person to send again. */
  status: "sent" | "pending" | "failed";
  /** Kept only while pending, so a resend uses exactly the same bytes. */
  ciphertext?: Uint8Array;
  clientId?: string;
}

export interface MlsDeviceRecord {
  userId: string;
  deviceId: string;
  state: Uint8Array;
  /** Kept so registration can be retried if the first attempt never reached the server. */
  signatureKey: Uint8Array;
  registered: boolean;
}

/** Everything one step changes. A store applies it all or nothing. */
export interface MlsChange {
  device?: MlsDeviceRecord;
  cursors?: Record<string, number>;
  messages?: MlsStoredMessage[];
  /** Local message IDs to delete, when a pending message is replaced by its sent copy. */
  deleteMessages?: { conversationId: string; id: string }[];
}

export interface MlsStore {
  loadDevice(): Promise<MlsDeviceRecord | null>;
  cursor(conversationId: string): Promise<number>;
  messages(conversationId: string): Promise<MlsStoredMessage[]>;
  apply(change: MlsChange): Promise<void>;
}

export class MlsSyncError extends Error {}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const KEY_PACKAGE_TARGET = 10;
const MAX_ATTEMPTS = 4;

/** The code people compare in person, from any MLS library's roster. `signatureKey` is base64url. */
export function codeForRoster(members: { userId: string; deviceId: string; signatureKey: string }[]): string {
  const lines = members.map((member) => `${member.userId}/${member.deviceId}/${member.signatureKey}`).sort();
  const digest = sha256(encoder.encode(["babillard/mls/code", ...lines].join("\n")));
  const groups: string[] = [];
  for (let i = 0; i < 12; i += 3) {
    const value = ((digest[i]! << 16) | (digest[i + 1]! << 8) | digest[i + 2]!) % 100000;
    groups.push(String(value).padStart(5, "0"));
  }
  return groups.join(" ");
}

/** Phones that may be added now: current members' registered phones. */
function trustedNow(state: MlsGroupState): TrustedDevice[] {
  return state.directory.map((device) => ({ userId: device.userId, deviceId: device.deviceId, signatureKey: fromBase64(device.signatureKey) }));
}

/** Phones that may appear in the group's history: anyone ever admitted, plus anyone admissible now. */
function trustedEver(state: MlsGroupState): TrustedDevice[] {
  const byDevice = new Map<string, TrustedDevice>();
  for (const device of [...state.admitted, ...state.directory]) {
    byDevice.set(device.deviceId, { userId: device.userId, deviceId: device.deviceId, signatureKey: fromBase64(device.signatureKey) });
  }
  return [...byDevice.values()];
}

export class MlsMessenger {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly crypto: MlsCrypto,
    private readonly transport: MlsTransport,
    private readonly store: MlsStore,
    private readonly me: { userId: string; deviceId: string },
    private readonly newClientId: () => string = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  ) {}

  /** Runs one operation after the last one finishes, whether or not it succeeded. */
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async device(): Promise<MlsDeviceRecord> {
    const device = await this.store.loadDevice();
    if (!device) throw new MlsSyncError("No MLS identity yet");
    return device;
  }

  private async saveState(state: Uint8Array, change: Omit<MlsChange, "device"> = {}): Promise<void> {
    const device = await this.device();
    await this.store.apply({ ...change, device: { ...device, state } });
  }

  /** Creates and registers this phone's identity if needed, and keeps its key packages topped up. */
  ensureIdentity(): Promise<void> {
    return this.serial(async () => {
      let device = await this.store.loadDevice();
      if (!device) {
        // Saved before registering, so a failed registration can be retried with the same key.
        const identity = await this.crypto.createIdentity(this.me.userId, this.me.deviceId);
        device = { ...this.me, state: identity.state, signatureKey: identity.signatureKey, registered: false };
        await this.store.apply({ device });
      }
      if (!device.registered) {
        // Registering the same key again is harmless, so this is safe to repeat.
        await this.transport.registerIdentity(this.me.deviceId, device.signatureKey);
        await this.store.apply({ device: { ...device, registered: true } });
      }
      await this.topUp();
    });
  }

  private async topUp(): Promise<void> {
    const available = await this.transport.keyPackageCount(this.me.deviceId);
    if (available >= KEY_PACKAGE_TARGET) return;
    let state = (await this.device()).state;
    const packages: Uint8Array[] = [];
    for (let i = available; i < KEY_PACKAGE_TARGET; i++) {
      const created = await this.crypto.createKeyPackage(state);
      state = created.state;
      packages.push(created.keyPackage);
    }
    // The private halves are saved before the public halves go anywhere.
    await this.saveState(state);
    await this.transport.uploadKeyPackages(this.me.deviceId, packages);
  }

  /** Brings a chat up to date and returns the messages it received. */
  sync(conversationId: string): Promise<MlsStoredMessage[]> {
    return this.serial(() => this.syncLocked(conversationId));
  }

  /** Sends text, after syncing and doing any chores the server needs first. */
  send(conversationId: string, text: string): Promise<MlsStoredMessage> {
    return this.serial(async () => {
      await this.syncLocked(conversationId);
      const localId = `local-${this.newClientId()}`;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const state = (await this.device()).state;
        const sealed = await this.crypto.encrypt(state, conversationId, encoder.encode(text), new Uint8Array());
        const pending: MlsStoredMessage = {
          conversationId,
          id: localId,
          seq: null,
          senderId: this.me.userId,
          senderDeviceId: this.me.deviceId,
          text,
          createdAt: Date.now(),
          status: "pending",
          ciphertext: sealed.message,
          clientId: this.newClientId(),
        };
        // Saved first: the key is used up whether or not the send gets through.
        await this.saveState(sealed.state, { messages: [pending] });
        const result = await this.transport.submit(conversationId, { deviceId: this.me.deviceId, message: sealed.message, clientId: pending.clientId! });
        if (result.ok) return this.markSent(pending, result.entry);
        if (result.error !== "stale_epoch" && result.error !== "pending_removal") throw new MlsSyncError(result.error);
        // Behind, or someone has to be removed first. Catch up, do the chores, and encrypt again.
        await this.syncLocked(conversationId);
      }
      throw new MlsSyncError("Couldn't send after several tries");
    });
  }

  /** Resends messages still pending after a network error, with exactly the same bytes. */
  retryPending(conversationId: string): Promise<void> {
    return this.serial(async () => {
      for (const message of (await this.store.messages(conversationId)).filter((m) => m.status === "pending")) {
        const result = await this.transport.submit(conversationId, { deviceId: this.me.deviceId, message: message.ciphertext!, clientId: message.clientId! });
        if (result.ok) await this.markSent(message, result.entry);
        // Refused for good: those bytes can never be accepted, and re-encrypting under the same key is not allowed.
        else await this.store.apply({ messages: [{ ...message, status: "failed", ciphertext: undefined, clientId: undefined }] });
      }
    });
  }

  private async markSent(pending: MlsStoredMessage, entry: MlsLogEntry): Promise<MlsStoredMessage> {
    const sent: MlsStoredMessage = { ...pending, id: String(entry.seq), seq: entry.seq, status: "sent", createdAt: entry.createdAt, ciphertext: undefined, clientId: undefined };
    await this.store.apply({ messages: [sent], deleteMessages: [{ conversationId: pending.conversationId, id: pending.id }] });
    return sent;
  }

  /** Submits a commit and adopts its state only if the server takes it. */
  private async commit(conversationId: string, output: MlsCommit): Promise<SubmitResult> {
    const result = await this.transport.submit(conversationId, {
      deviceId: this.me.deviceId,
      message: output.commit,
      groupInfo: output.groupInfo,
      ...(output.welcome ? { welcome: output.welcome } : {}),
    });
    if (result.ok) await this.saveState(output.state, { cursors: { [conversationId]: result.entry.seq } });
    return result;
  }

  private async syncLocked(conversationId: string): Promise<MlsStoredMessage[]> {
    const received: MlsStoredMessage[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const server = await this.transport.groupState(conversationId);
      const trusted = trustedEver(server);
      const state = (await this.device()).state;
      const local = await this.crypto.groupStatus(state, conversationId);

      if (!local) {
        const joined = await this.joinOrCreate(conversationId, server, trusted, state);
        if (joined === "wait") return received;
        if (joined === "retry") continue;
      }

      received.push(...(await this.catchUp(conversationId, trusted)));
      const chore = await this.doChores(conversationId);
      if (chore === "done") return received;
      // A chore lost a race. Read what won and look again.
    }
    return received;
  }

  /** Gets this phone into the chat's group: creating it, joining from a Welcome, or joining by itself. */
  private async joinOrCreate(conversationId: string, server: MlsGroupState, trusted: TrustedDevice[], state: Uint8Array): Promise<"joined" | "wait" | "retry"> {
    if (server.roster.length === 0) {
      // Nobody has made the group yet. Make it with an empty commit, whose update path proves who made
      // it, as the server requires. Not every MLS library adds a path to an add-only commit, so the
      // other phones are added in the next commit, by the chores below.
      const created = await this.crypto.createGroup(state, conversationId);
      const output = await this.crypto.updateKeys(created, conversationId);
      const result = await this.commit(conversationId, output);
      if (result.ok) return "joined";
      if (result.error === "not_ready") return "wait"; // Someone can't do MLS yet. The chat stays on v1.
      if (result.error === "stale_epoch") return "retry"; // Someone else made it first.
      throw new MlsSyncError(result.error);
    }

    const welcome = await this.transport.welcome(conversationId, this.me.deviceId);
    if (welcome) {
      const joined = await this.crypto.joinFromWelcome(state, welcome.welcome, trusted);
      await this.saveState(joined.state, { cursors: { [conversationId]: welcome.seq } });
      return "joined";
    }

    const groupInfo = await this.transport.groupInfo(conversationId);
    if (!groupInfo) return "wait";
    const joined = await this.crypto.joinExternal(state, groupInfo, trusted);
    const result = await this.commit(conversationId, joined);
    if (result.ok) return "joined";
    if (result.error === "stale_epoch") return "retry";
    throw new MlsSyncError(result.error);
  }

  /** Applies the log from this phone's cursor, saving state, cursor, and text together for each entry. */
  private async catchUp(conversationId: string, trusted: TrustedDevice[]): Promise<MlsStoredMessage[]> {
    const received: MlsStoredMessage[] = [];
    let cursor = await this.store.cursor(conversationId);
    for (;;) {
      const entries = await this.transport.log(conversationId, cursor);
      if (!entries.length) return received;
      for (const entry of entries) {
        cursor = entry.seq;
        if (entry.deviceId === this.me.deviceId) {
          // This phone's own entry, applied when it was sent.
          await this.store.apply({ cursors: { [conversationId]: cursor } });
          continue;
        }
        const state = (await this.device()).state;
        const result = await this.crypto.receive(state, conversationId, fromBase64(entry.message), trusted);
        if (result.kind === "commit") {
          await this.saveState(result.state, { cursors: { [conversationId]: cursor } });
          if (result.removedMe) throw new MlsSyncError("This phone was removed from the chat");
          continue;
        }
        // MLS authenticates the sender. The server's label must agree with it.
        if (result.senderUserId && result.senderUserId !== entry.senderId) throw new MlsSyncError("The server named the wrong sender");
        const message: MlsStoredMessage = {
          conversationId,
          id: String(entry.seq),
          seq: entry.seq,
          senderId: entry.senderId,
          senderDeviceId: result.senderDeviceId ?? entry.deviceId,
          text: decoder.decode(result.plaintext),
          createdAt: entry.createdAt,
          status: "sent",
        };
        await this.saveState(result.state, { cursors: { [conversationId]: cursor }, messages: [message] });
        received.push(message);
      }
    }
  }

  /** Removes phones that should be gone, then adds phones waiting to join. */
  private async doChores(conversationId: string): Promise<"done" | "retry"> {
    const server = await this.transport.groupState(conversationId);
    const trusted = trustedNow(server);
    if (server.pendingRemovals.length) {
      const state = (await this.device()).state;
      const output = await this.crypto.removeLeaves(state, conversationId, server.pendingRemovals.map((entry) => entry.leafIndex));
      const result = await this.commit(conversationId, output);
      if (!result.ok) {
        if (result.error === "stale_epoch") return "retry";
        throw new MlsSyncError(result.error);
      }
    }
    const waiting = server.pendingAdds.filter((device) => device.deviceId !== this.me.deviceId).map((device) => device.deviceId);
    if (waiting.length) {
      let packages;
      try {
        packages = await this.transport.claimKeyPackages(conversationId, waiting);
      } catch (error) {
        // Another phone added them first, so they're no longer waiting. Look again.
        if (error instanceof MlsHttpError && error.status === 403) return "retry";
        throw error;
      }
      if (packages.length) {
        const state = (await this.device()).state;
        const output = await this.crypto.addMembers(state, conversationId, packages.map((p) => p.keyPackage), trusted);
        const result = await this.commit(conversationId, output);
        if (!result.ok) {
          if (result.error === "stale_epoch") return "retry";
          throw new MlsSyncError(result.error);
        }
      }
    }
    return "done";
  }

  /** The chat's security code, from this phone's own copy of the group. */
  async securityCode(conversationId: string): Promise<string | null> {
    const status = await this.crypto.groupStatus((await this.device()).state, conversationId);
    return status ? codeForRoster(status.roster.map((entry) => ({ ...entry, signatureKey: toBase64(entry.signatureKey) }))) : null;
  }
}

/** A store that keeps everything in memory, for tests. Each change replaces values whole, as a database would. */
export class MemoryMlsStore implements MlsStore {
  private device: MlsDeviceRecord | null = null;
  private readonly cursors = new Map<string, number>();
  private readonly stored = new Map<string, MlsStoredMessage>();

  async loadDevice() {
    return this.device;
  }
  async cursor(conversationId: string) {
    return this.cursors.get(conversationId) ?? 0;
  }
  async messages(conversationId: string) {
    return [...this.stored.values()].filter((m) => m.conversationId === conversationId).sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity));
  }
  async apply(change: MlsChange) {
    if (change.device) this.device = change.device;
    for (const [id, cursor] of Object.entries(change.cursors ?? {})) this.cursors.set(id, cursor);
    for (const message of change.deleteMessages ?? []) this.stored.delete(`${message.conversationId}/${message.id}`);
    for (const message of change.messages ?? []) this.stored.set(`${message.conversationId}/${message.id}`, message);
  }
}
