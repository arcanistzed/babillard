import type { MlsGroupState, MlsLogEntry } from "./api";
import { toBase64 } from "./e2ee";
import type { HistoryRef, MlsTransport } from "./mlsClient";
import { decide, pendingAdds, pendingRemovals, type Directory, type RosterEntry } from "./mlsDelivery";
import { readKeyPackage } from "./mlsWire";
import { MlsHttpError } from "./mlsTransport";

/**
 * The server's MLS behaviour in memory, with the same `decide` rules the
 * ChatRoom Durable Object uses. For fast tests and for the dev screen, which
 * runs several phones' engines on one device. Not a security boundary: it
 * trusts the user and device each transport claims.
 */

/** The page size the server uses, small here so tests go past one page. */
const HISTORY_PAGE = 3;

interface Chat {
  members: Set<string>;
  /** Device ID to user and key, for every phone ever in the group. */
  admitted: Map<string, { userId: string; signatureKey: string }>;
  epoch: number;
  roster: RosterEntry[];
  log: MlsLogEntry[];
  welcomes: Map<string, { seq: number; welcome: Uint8Array }>;
  groupInfo: Uint8Array | null;
}

export class MemoryMlsServer {
  private readonly devices = new Map<string, { userId: string; signatureKey: string }>();
  private readonly packages = new Map<string, Uint8Array[]>();
  private readonly chats = new Map<string, Chat>();
  /** Backup v2: each person's key fingerprint, and their sealed history keyed by person, chat and seq. */
  private readonly historyKeys = new Map<string, string>();
  private readonly history = new Map<string, { keyId: string; conversationId: string; seq: number; sealed: Uint8Array }>();
  /** False is MLS_ENABLED=paused: no chat starts a group, and groups that exist carry on. */
  newGroups = true;

  /** Creates a chat with these members, or changes who's in it. */
  setMembers(conversationId: string, userIds: string[]): void {
    const chat = this.chats.get(conversationId);
    if (chat) chat.members = new Set(userIds);
    else this.chats.set(conversationId, { members: new Set(userIds), admitted: new Map(), epoch: 0, roster: [], log: [], welcomes: new Map(), groupInfo: null });
  }

  /** As when someone signs in on a sixth phone: the oldest is retired and must leave its groups. */
  retireDevice(deviceId: string): void {
    this.devices.delete(deviceId);
    this.packages.delete(deviceId);
  }

  private chat(conversationId: string): Chat {
    const chat = this.chats.get(conversationId);
    if (!chat) throw new Error("No such chat");
    return chat;
  }

  private withKeyPackages(chat: Chat): Set<string> {
    const users = new Set<string>();
    for (const [deviceId, device] of this.devices) {
      if (chat.members.has(device.userId) && this.packages.get(deviceId)?.length) users.add(device.userId);
    }
    return users;
  }

  private directory(chat: Chat): Directory {
    const directory: Directory = new Map();
    for (const [deviceId, device] of this.devices) {
      if (!chat.members.has(device.userId)) continue;
      if (!directory.has(device.userId)) directory.set(device.userId, new Map());
      directory.get(device.userId)!.set(deviceId, device.signatureKey);
    }
    return directory;
  }

  /** What one phone sees of the server. */
  transportFor(userId: string, deviceId: string): MlsTransport {
    const memberChat = (conversationId: string) => {
      const chat = this.chat(conversationId);
      if (!chat.members.has(userId)) throw new MlsHttpError(404, "conversation_not_found");
      return chat;
    };
    return {
      registerIdentity: async (id, signatureKey) => {
        if (id !== deviceId) throw new Error("wrong device");
        this.devices.set(id, { userId, signatureKey: toBase64(signatureKey) });
      },
      uploadKeyPackages: async (id, keyPackages) => {
        for (const bytes of keyPackages) {
          const parsed = readKeyPackage(bytes);
          if (parsed.identity !== `${userId}/${id}` || toBase64(parsed.signatureKey) !== this.devices.get(id)?.signatureKey) throw new Error("key package mismatch");
        }
        this.packages.set(id, [...(this.packages.get(id) ?? []), ...keyPackages]);
      },
      keyPackageCount: async (id) => this.packages.get(id)?.length ?? 0,
      claimKeyPackages: async (conversationId, deviceIds) => {
        const chat = memberChat(conversationId);
        const waiting = new Set(pendingAdds(chat.roster, this.directory(chat)).map((device) => device.deviceId));
        return deviceIds.flatMap((id) => {
          if (!waiting.has(id)) throw new MlsHttpError(403, "not_waiting_to_join");
          const keyPackage = this.packages.get(id)?.shift();
          return keyPackage ? [{ deviceId: id, keyPackage }] : [];
        });
      },
      groupState: async (conversationId): Promise<MlsGroupState> => {
        const chat = memberChat(conversationId);
        const directory = this.directory(chat);
        return {
          mode: chat.roster.length ? "mls" : "v1",
          epoch: chat.epoch,
          lastSeq: chat.log.length,
          roster: chat.roster,
          pendingAdds: pendingAdds(chat.roster, directory),
          pendingRemovals: pendingRemovals(chat.roster, directory),
          directory: [...directory].flatMap(([member, devices]) => [...devices].map(([id, signatureKey]) => ({ userId: member, deviceId: id, signatureKey }))),
          admitted: [...chat.admitted].map(([id, device]) => ({ deviceId: id, ...device })),
        };
      },
      submit: async (conversationId, body) => {
        const chat = memberChat(conversationId);
        if (body.clientId) {
          const existing = chat.log.find((entry) => entry.deviceId === body.deviceId && entry.clientId === body.clientId);
          if (existing) return { ok: true, entry: existing };
        }
        const decision = decide({
          conversationId,
          epoch: chat.epoch,
          roster: chat.roster,
          directory: this.directory(chat),
          memberIds: [...chat.members],
          newGroups: this.newGroups,
          withKeyPackages: this.withKeyPackages(chat),
          sender: { userId, deviceId: body.deviceId },
          message: body.message,
          ...(body.welcome ? { welcome: body.welcome } : {}),
          ...(body.groupInfo ? { groupInfo: body.groupInfo } : {}),
        });
        if (!decision.ok) return { ok: false, error: decision.error, status: 409 };
        const entry: MlsLogEntry = {
          seq: chat.log.length + 1,
          epoch: decision.epoch,
          kind: decision.kind,
          senderId: userId,
          deviceId: body.deviceId,
          message: toBase64(body.message),
          clientId: body.clientId ?? null,
          createdAt: Date.now(),
        };
        chat.log.push(entry);
        if (decision.kind === "commit") {
          const directory = this.directory(chat);
          for (const entry of decision.roster) {
            const signatureKey = directory.get(entry.userId)?.get(entry.deviceId);
            if (signatureKey && !chat.admitted.has(entry.deviceId)) chat.admitted.set(entry.deviceId, { userId: entry.userId, signatureKey });
          }
          chat.epoch = decision.nextEpoch;
          chat.roster = decision.roster;
          chat.groupInfo = body.groupInfo ?? null;
          for (const added of decision.added) chat.welcomes.set(added.deviceId, { seq: entry.seq, welcome: body.welcome! });
          // As the Worker does: a Welcome for a phone that has since been removed would only lead back to its removal.
          for (const deviceId of chat.welcomes.keys()) if (!chat.roster.some((r) => r.deviceId === deviceId)) chat.welcomes.delete(deviceId);
        }
        return { ok: true, entry };
      },
      log: async (conversationId, since) => memberChat(conversationId).log.filter((entry) => entry.seq > since),
      welcome: async (conversationId, id) => memberChat(conversationId).welcomes.get(id) ?? null,
      groupInfo: async (conversationId) => memberChat(conversationId).groupInfo,
      historyKeyId: async () => this.historyKeys.get(userId) ?? null,
      setHistoryKeyId: async (keyId, replace) => {
        const current = this.historyKeys.get(userId);
        if (keyId !== null && current === keyId) return "ok";
        if (keyId !== null && current && !replace) return "exists";
        for (const key of this.history.keys()) if (key.startsWith(`${userId}/`)) this.history.delete(key);
        if (keyId === null) this.historyKeys.delete(userId);
        else this.historyKeys.set(userId, keyId);
        return "ok";
      },
      uploadHistory: async (keyId, entries) => {
        if (this.historyKeys.get(userId) !== keyId) return "key_changed";
        const rejected: HistoryRef[] = [];
        for (const entry of entries) {
          const chat = this.chats.get(entry.conversationId);
          const message = chat?.members.has(userId) ? chat.log.find((logged) => logged.seq === entry.seq && logged.kind === "application") : undefined;
          if (!message) rejected.push({ conversationId: entry.conversationId, seq: entry.seq });
          else {
            const key = `${userId}/${entry.conversationId}/${entry.seq}`;
            if (!this.history.has(key)) this.history.set(key, { keyId, conversationId: entry.conversationId, seq: entry.seq, sealed: entry.sealed });
          }
        }
        return { rejected };
      },
      history: async (conversationId, after) => {
        memberChat(conversationId);
        const keyId = this.historyKeys.get(userId);
        return [...this.history.entries()]
          .filter(([key, entry]) => key.startsWith(`${userId}/`) && entry.conversationId === conversationId && entry.keyId === keyId && entry.seq > after)
          .map(([, entry]) => ({ seq: entry.seq, sealed: entry.sealed }))
          .sort((a, b) => a.seq - b.seq)
          .slice(0, HISTORY_PAGE);
      },
    };
  }

  /** As the leave route does: the person's history for the chat goes with them. */
  forgetHistory(userId: string, conversationId: string): void {
    for (const [key, entry] of this.history) if (key.startsWith(`${userId}/`) && entry.conversationId === conversationId) this.history.delete(key);
  }

  /** How many history entries the server holds for someone, for tests. */
  historyCount(userId: string): number {
    return [...this.history.keys()].filter((key) => key.startsWith(`${userId}/`)).length;
  }
}
