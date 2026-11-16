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

export type MeetupState = "proposed" | "confirmed" | "cancelled" | "done";

/**
 * Where a meetup's state belongs given its yes count. Enough yeses confirm a proposal.
 * A confirmed meetup that loses them goes back to proposed, but only before it starts: after that it stays as it was so the did-you-meet check-in still happens.
 */
export function settledMeetupState(meetup: { state: MeetupState; startsAt: number }, kind: ConversationKind, yesCount: number, memberCount: number, now: number): MeetupState {
  const enough = isMeetupConfirmed(kind, yesCount, memberCount);
  if (meetup.state === "proposed" && enough) return "confirmed";
  if (meetup.state === "confirmed" && !enough && now < meetup.startsAt) return "proposed";
  return meetup.state;
}
