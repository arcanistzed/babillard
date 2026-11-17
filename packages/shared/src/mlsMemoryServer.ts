import type { MlsGroupState, MlsLogEntry } from "./api";
import { toBase64 } from "./e2ee";
import type { MlsTransport } from "./mlsClient";
import { decide, pendingAdds, pendingRemovals, type Directory, type RosterEntry } from "./mlsDelivery";
import { readKeyPackage } from "./mlsWire";
import { MlsHttpError } from "./mlsTransport";

/**
 * The server's MLS behaviour in memory, with the same `decide` rules the
 * ChatRoom Durable Object uses. For fast tests and for the dev screen, which
 * runs several phones' engines on one device. Not a security boundary: it
 * trusts the user and device each transport claims.
 */

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
      if (!chat.members.has(userId)) throw new Error("not a member");
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
        }
        return { ok: true, entry };
      },
      log: async (conversationId, since) => memberChat(conversationId).log.filter((entry) => entry.seq > since),
      welcome: async (conversationId, id) => memberChat(conversationId).welcomes.get(id) ?? null,
      groupInfo: async (conversationId) => memberChat(conversationId).groupInfo,
    };
  }
}
