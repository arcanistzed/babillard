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
