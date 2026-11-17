import { GROUP_MEETUP_CONFIRM_YES } from "../constants";

export type ConversationKind = "direct" | "group";

/** Direct chats need both people. Groups need three yeses, or everyone if the group has shrunk below three. */
export function requiredYesCount(kind: ConversationKind, memberCount: number): number {
  if (kind === "direct") return 2;
  return Math.min(GROUP_MEETUP_CONFIRM_YES, Math.max(memberCount, 2));
}

export function isMeetupConfirmed(kind: ConversationKind, yesCount: number, memberCount: number): boolean {
  return yesCount >= requiredYesCount(kind, memberCount);
}

/** How many more yeses a meetup needs to be on. Zero once it has enough. */
export function yesStillNeeded(kind: ConversationKind, yesCount: number, memberCount: number): number {
  return Math.max(0, requiredYesCount(kind, memberCount) - yesCount);
}

/** How long after one announcement about a meetup before an answer can set off another, so flipping yes and no can't flood the chat. */
export const MEETUP_ANNOUNCE_COOLDOWN_MS = 10 * 60 * 1000;

/** Whether enough time has passed since the last announcement. Never announced counts as long enough. */
export function isAnnouncementDue(lastAnnouncedAt: number | null, now: number, cooldownMs: number): boolean {
  return lastAnnouncedAt === null || now - lastAnnouncedAt >= cooldownMs;
}
