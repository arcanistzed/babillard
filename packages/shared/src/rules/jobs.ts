import type { JobOffsets } from "../constants";

export interface MatchTiming {
  createdAt: number;
  expiresAt: number;
  nudgedAt: number | null;
  lastUserMessageAt: number | null;
  state: "active" | "expired" | "closed";
}

export interface MeetupTiming {
  startsAt: number;
  endsAt: number;
  state: "proposed" | "confirmed" | "cancelled" | "done";
  reminderSentAt: number | null;
  checkinSentAt: number | null;
}

function isSilent(match: MatchTiming): boolean {
  return match.state === "active" && match.lastUserMessageAt === null;
}

export function matchExpiresAt(createdAt: number, offsets: JobOffsets): number {
  return createdAt + offsets.matchExpiryMs;
}

export function isNudgeDue(match: MatchTiming, now: number, offsets: JobOffsets): boolean {
  return isSilent(match) && match.nudgedAt === null && now >= match.createdAt + offsets.nudgeAfterMs && now < match.expiresAt;
}

export function isMatchExpired(match: MatchTiming, now: number): boolean {
  return isSilent(match) && now >= match.expiresAt;
}

export function isReminderDue(meetup: MeetupTiming, now: number, offsets: JobOffsets): boolean {
  return (
    meetup.state === "confirmed" &&
    meetup.reminderSentAt === null &&
    now >= meetup.startsAt - offsets.meetupReminderLeadMs &&
    now < meetup.startsAt
  );
}

export function isCheckinDue(meetup: MeetupTiming, now: number, offsets: JobOffsets): boolean {
  return meetup.state === "confirmed" && meetup.checkinSentAt === null && now >= meetup.endsAt + offsets.meetupCheckinDelayMs;
}

/** A proposal nobody confirmed before its start time is dead. */
export function isProposalStale(meetup: MeetupTiming, now: number): boolean {
  return meetup.state === "proposed" && now >= meetup.startsAt;
}
