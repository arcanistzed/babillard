import { toBase64 } from "./e2ee";
import { MlsWireError, isWelcome, parseIdentity, readFrame, readGroupInfo, type Identity } from "./mlsWire";

/**
 * The server's rules for one chat's MLS group, as a pure function. The ChatRoom
 * Durable Object calls `decide` with its current epoch and roster, plus the
 * chat's members from D1, and applies the result in one synchronous step.
 *
 * The server can't read messages, but it can read every commit, because commits
 * travel as PublicMessages. That lets it keep its own roster and refuse:
 * - anything out of order (one commit per epoch, messages only at the current epoch)
 * - adding a phone that isn't a current member's registered phone
 * - removing anyone who should still be there (members can't kick each other)
 * - new messages while a phone that should be gone is still in the group
 */

export interface RosterEntry {
  leafIndex: number;
  userId: string;
  deviceId: string;
}

/** Current members' phones that can do MLS, from D1: user ID to device ID to signing key (base64url). */
export type Directory = Map<string, Map<string, string>>;

export type DeliveryError =
  | "not_mls"
  | "wrong_group"
  | "stale_epoch"
  | "not_a_member"
  | "unknown_device"
  | "no_group"
  | "not_in_group"
  | "wrong_sender"
  | "bad_credential"
  | "removal_not_allowed"
  | "add_not_allowed"
  | "welcome_required"
  | "bad_group_info"
  | "pending_removal"
  | "must_be_encrypted"
  | "must_be_public";

export type Decision =
  | { ok: true; kind: "application"; epoch: number }
  | { ok: true; kind: "commit"; epoch: number; nextEpoch: number; roster: RosterEntry[]; added: RosterEntry[] }
  | { ok: false; error: DeliveryError; epoch: number };

export interface Submission {
  conversationId: string;
  epoch: number;
  roster: RosterEntry[];
  directory: Directory;
  sender: { userId: string; deviceId: string };
  message: Uint8Array;
  welcome?: Uint8Array;
  groupInfo?: Uint8Array;
}

/** Phones that are in the group but shouldn't be: their owner left, or the phone was retired. */
export function pendingRemovals(roster: RosterEntry[], directory: Directory): RosterEntry[] {
  return roster.filter((entry) => !directory.get(entry.userId)?.has(entry.deviceId));
}

/** Members' phones that aren't in the group yet. */
export function pendingAdds(roster: RosterEntry[], directory: Directory): { userId: string; deviceId: string }[] {
  const inGroup = new Set(roster.map((entry) => entry.deviceId));
  return [...directory].flatMap(([userId, devices]) => [...devices.keys()].filter((deviceId) => !inGroup.has(deviceId)).map((deviceId) => ({ userId, deviceId })));
}

function vouched(directory: Directory, identity: Identity): { userId: string; deviceId: string } | null {
  const parsed = parseIdentity(identity.identity);
  if (!parsed) return null;
  const key = directory.get(parsed.userId)?.get(parsed.deviceId);
  return key !== undefined && key === toBase64(identity.signatureKey) ? parsed : null;
}

export function decide(input: Submission): Decision {
  const { conversationId, epoch, roster, directory, sender } = input;
  const refuse = (error: DeliveryError): Decision => ({ ok: false, error, epoch });

  if (!directory.has(sender.userId)) return refuse("not_a_member");
  if (!directory.get(sender.userId)!.has(sender.deviceId)) return refuse("unknown_device");

  let frame;
  try {
    frame = readFrame(input.message);
  } catch (error) {
    if (error instanceof MlsWireError) return refuse("not_mls");
    throw error;
  }
  if (frame.groupId !== conversationId) return refuse("wrong_group");
  if (frame.epoch !== epoch) return refuse("stale_epoch");

  if (frame.kind === "application") {
    if (frame.wireformat !== "private") return refuse("must_be_encrypted");
    if (roster.length === 0) return refuse("no_group");
    if (!roster.some((entry) => entry.deviceId === sender.deviceId)) return refuse("not_in_group");
    if (pendingRemovals(roster, directory).length) return refuse("pending_removal");
    return { ok: true, kind: "application", epoch };
  }

  if (frame.kind !== "commit") return refuse("not_mls");
  if (frame.wireformat !== "public" || frame.sender.type !== "member" || !frame.commit) return refuse("must_be_public");
  const { leafIndex } = frame.sender;
  const summary = frame.commit;

  let next: RosterEntry[];
  if (roster.length === 0) {
    // The first commit creates the group on the server. Its author is leaf 0, and it must carry
    // an update path, whose leaf shows the author's identity. Otherwise anyone could replay a
    // creator's commit and claim leaf 0. OpenMLS always includes the path when adding.
    if (epoch !== 0 || leafIndex !== 0 || !summary.pathLeaf) return refuse("wrong_sender");
    next = [{ leafIndex: 0, ...sender }];
  } else {
    const author = roster.find((entry) => entry.leafIndex === leafIndex);
    if (author?.deviceId !== sender.deviceId || author.userId !== sender.userId) return refuse("wrong_sender");
    next = roster.map((entry) => ({ ...entry }));
  }

  // A committer's new leaf must keep its own identity and registered key.
  if (summary.pathLeaf) {
    const who = vouched(directory, summary.pathLeaf);
    if (who?.userId !== sender.userId || who.deviceId !== sender.deviceId) return refuse("bad_credential");
  }

  // RFC 9420 applies removals before adds, so an add can reuse a leaf freed in the same commit.
  const removable = new Set(pendingRemovals(next, directory).map((entry) => entry.leafIndex));
  for (const removed of summary.removes) {
    if (removed === leafIndex || !removable.has(removed)) return refuse("removal_not_allowed");
    next = next.filter((entry) => entry.leafIndex !== removed);
    removable.delete(removed);
  }

  const added: RosterEntry[] = [];
  for (const add of summary.adds) {
    const who = vouched(directory, add);
    if (!who || next.some((entry) => entry.deviceId === who.deviceId)) return refuse("add_not_allowed");
    const taken = new Set(next.map((entry) => entry.leafIndex));
    let free = 0;
    while (taken.has(free)) free++;
    const entry = { leafIndex: free, ...who };
    next.push(entry);
    added.push(entry);
  }

  if (added.length && !input.welcome) return refuse("welcome_required");
  if (input.welcome && (!added.length || !isWelcome(input.welcome))) return refuse("not_mls");
  if (input.groupInfo) {
    try {
      const info = readGroupInfo(input.groupInfo);
      if (info.groupId !== conversationId || info.epoch !== epoch + 1) return refuse("bad_group_info");
    } catch {
      return refuse("bad_group_info");
    }
  }

  next.sort((a, b) => a.leafIndex - b.leafIndex);
  return { ok: true, kind: "commit", epoch, nextEpoch: epoch + 1, roster: next, added };
}
