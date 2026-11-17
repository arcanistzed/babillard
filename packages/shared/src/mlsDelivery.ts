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
 * - moving a chat to MLS before every member has a phone that can follow
 *
 * It also accepts external commits, where a member's phone adds itself from the
 * latest GroupInfo. Every commit must carry that GroupInfo, so a chat can always
 * recover, even if no phone in its group is ever online again.
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
  | "must_be_public"
  | "not_ready"
  | "group_info_required"
  | "already_in_group";

export type Decision =
  | { ok: true; kind: "application"; epoch: number }
  | { ok: true; kind: "commit"; epoch: number; nextEpoch: number; roster: RosterEntry[]; added: RosterEntry[] }
  | { ok: false; error: DeliveryError; epoch: number };

export interface Submission {
  conversationId: string;
  epoch: number;
  roster: RosterEntry[];
  directory: Directory;
  /** Every active member of the chat, including anyone with no MLS phone yet. */
  memberIds: string[];
  /** False while MLS is paused: chats already on MLS carry on, and no other chat moves to it. */
  newGroups?: boolean;
  /**
   * Members with a current phone that has a key package waiting, so the group's creator can add
   * them at once. Checked only for the group's first commit. Left out, nobody is checked.
   */
  withKeyPackages?: Set<string>;
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
  if (frame.wireformat !== "public" || !frame.commit) return refuse("must_be_public");
  const summary = frame.commit;

  // Every commit carries the next epoch's GroupInfo. Keeping it current is what lets a phone
  // rejoin on its own later, even if no phone left in the group is ever online again.
  if (!input.groupInfo) return refuse("group_info_required");
  try {
    const info = readGroupInfo(input.groupInfo);
    if (info.groupId !== conversationId || info.epoch !== epoch + 1) return refuse("bad_group_info");
  } catch {
    return refuse("bad_group_info");
  }

  // Whoever commits, their new leaf must keep their own identity and registered key.
  if (summary.pathLeaf) {
    const who = vouched(directory, summary.pathLeaf);
    if (who?.userId !== sender.userId || who.deviceId !== sender.deviceId) return refuse("bad_credential");
  }

  const freeLeaf = (entries: RosterEntry[]) => {
    const taken = new Set(entries.map((entry) => entry.leafIndex));
    let free = 0;
    while (taken.has(free)) free++;
    return free;
  };
  const done = (next: RosterEntry[], added: RosterEntry[]): Decision => ({
    ok: true,
    kind: "commit",
    epoch,
    nextEpoch: epoch + 1,
    roster: [...next].sort((a, b) => a.leafIndex - b.leafIndex),
    added,
  });

  if (frame.sender.type !== "member") {
    // An external commit: a member's phone adds itself from the stored GroupInfo. This is how a
    // phone joins with nobody else online, and how a chat recovers if every phone in it is gone.
    if (frame.sender.senderType !== 4 || summary.externalInits !== 1 || summary.adds.length || input.welcome) return refuse("must_be_public");
    if (roster.length === 0) return refuse("no_group");
    if (!summary.pathLeaf) return refuse("bad_credential");
    // It may remove only the same phone's old leaf, which is how a phone that lost its state rejoins.
    let next = roster.map((entry) => ({ ...entry }));
    for (const removed of summary.removes) {
      const entry = next.find((candidate) => candidate.leafIndex === removed);
      if (entry?.deviceId !== sender.deviceId) return refuse("removal_not_allowed");
      next = next.filter((candidate) => candidate.leafIndex !== removed);
    }
    if (next.some((entry) => entry.deviceId === sender.deviceId)) return refuse("already_in_group");
    const entry = { leafIndex: freeLeaf(next), ...sender };
    return done([...next, entry], []);
  }

  if (summary.externalInits) return refuse("must_be_public");
  const { leafIndex } = frame.sender;
  let next: RosterEntry[];
  if (roster.length === 0) {
    // The first commit creates the group on the server. Its author is leaf 0, and it must carry
    // an update path, whose leaf shows the author's identity. Otherwise anyone could replay a
    // creator's commit and claim leaf 0. OpenMLS always includes the path when adding.
    if (epoch !== 0 || leafIndex !== 0 || !summary.pathLeaf) return refuse("wrong_sender");
    // A chat moves to MLS only once everyone in it can follow. After this, v1 is refused.
    if (input.memberIds.some((memberId) => !directory.get(memberId)?.size)) return refuse("not_ready");
    // A phone registers its signing key a moment before its key packages are up. A creator who
    // started then couldn't add it, and would send its first messages to a group without it. The
    // phone would then join by itself, after those messages, and never read them.
    const stocked = input.withKeyPackages;
    if (stocked && input.memberIds.some((memberId) => memberId !== sender.userId && !stocked.has(memberId))) return refuse("not_ready");
    // Paused looks the same to a phone as a member who can't follow yet: it waits, and the chat stays on v1.
    if (input.newGroups === false) return refuse("not_ready");
    next = [{ leafIndex: 0, ...sender }];
  } else {
    const author = roster.find((entry) => entry.leafIndex === leafIndex);
    if (author?.deviceId !== sender.deviceId || author.userId !== sender.userId) return refuse("wrong_sender");
    next = roster.map((entry) => ({ ...entry }));
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
    const entry = { leafIndex: freeLeaf(next), ...who };
    next.push(entry);
    added.push(entry);
  }

  if (added.length && !input.welcome) return refuse("welcome_required");
  if (input.welcome && (!added.length || !isWelcome(input.welcome))) return refuse("not_mls");
  return done(next, added);
}
