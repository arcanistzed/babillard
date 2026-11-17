import { GROUP_MEETUP_CONFIRM_YES, type JobOffsets } from "../constants";

export type ConversationKind = "direct" | "group";

/** Direct chats need both people. Groups need three yeses, or everyone if the group has shrunk below three. */
export function requiredYesCount(kind: ConversationKind, memberCount: number): number {
  if (kind === "direct") return 2;
  return Math.min(GROUP_MEETUP_CONFIRM_YES, Math.max(memberCount, 2));
}

export function isMeetupConfirmed(kind: ConversationKind, yesCount: number, memberCount: number): boolean {
  return yesCount >= requiredYesCount(kind, memberCount);
}

/**
 * How many yeses a confirmed meetup needs to stay on. Only people who were in the chat when it was proposed, and are still there,
 * set the bar, so someone joining a group of two can't take a meetup the other two agreed on back off. People backing out still can.
 * This is never more than requiredYesCount for the whole chat, so a meetup can't flip back and forth on its own.
 */
export function requiredYesToStayConfirmed(kind: ConversationKind, membersAtProposal: number): number {
  return requiredYesCount(kind, membersAtProposal);
}

/** Whether a confirmed meetup has lost the yeses it needs and goes back to proposed. */
export function isConfirmationLost(kind: ConversationKind, yesCount: number, membersAtProposal: number): boolean {
  return yesCount < requiredYesToStayConfirmed(kind, membersAtProposal);
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

/** How long after a meetup ends the app starts asking whether people met. The push comes later, after the check-in delay. */
export const MEETUP_CHECKIN_PROMPT_MS = 2 * 60 * 60 * 1000;

/** The Chats tab stops asking about a meetup this long after it ended. The meetup's own screen still takes an answer. */
export const MEETUP_CHECKIN_PROMPT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface MeetupCheckinTiming {
  endsAt: number;
  state: "proposed" | "confirmed" | "cancelled" | "done";
  checkinSentAt: number | null;
}

/**
 * Whether people can say if they met. It opens in the app a couple of hours after a confirmed meetup ends,
 * and never later than the "Did you meet?" push, which marks the meetup done.
 */
export function isCheckinOpen(meetup: MeetupCheckinTiming, now: number, offsets: Pick<JobOffsets, "meetupCheckinDelayMs">): boolean {
  if (meetup.checkinSentAt !== null) return true;
  if (meetup.state !== "confirmed" && meetup.state !== "done") return false;
  return now >= meetup.endsAt + Math.min(MEETUP_CHECKIN_PROMPT_MS, offsets.meetupCheckinDelayMs);
}

/** Whether the Chats tab should ask this person about a meetup: they said yes, haven't answered, and it ended recently. */
export function isCheckinPromptDue(
  meetup: MeetupCheckinTiming & { myResponse: "yes" | "no" | "maybe" | null; myDidMeet: boolean | null },
  now: number,
  offsets: Pick<JobOffsets, "meetupCheckinDelayMs">,
): boolean {
  return meetup.myResponse === "yes" && meetup.myDidMeet === null && isCheckinOpen(meetup, now, offsets) && now - meetup.endsAt <= MEETUP_CHECKIN_PROMPT_WINDOW_MS;
}
