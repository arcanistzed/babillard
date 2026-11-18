import { DEFAULT_JOB_OFFSETS, parseMlsMode, parseMlsTesters, type JobOffsets, type MlsMode, type MlsTesters } from "@babillard/shared";

export type { MlsMode };

function override(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function jobOffsets(env: Env): JobOffsets {
  return {
    nudgeAfterMs: override(env.NUDGE_AFTER_MS, DEFAULT_JOB_OFFSETS.nudgeAfterMs),
    matchExpiryMs: override(env.MATCH_EXPIRY_MS, DEFAULT_JOB_OFFSETS.matchExpiryMs),
    meetupReminderLeadMs: override(env.MEETUP_REMINDER_LEAD_MS, DEFAULT_JOB_OFFSETS.meetupReminderLeadMs),
    meetupCheckinDelayMs: override(env.MEETUP_CHECKIN_DELAY_MS, DEFAULT_JOB_OFFSETS.meetupCheckinDelayMs),
  };
}

export function isDevMode(env: Env): boolean {
  return env.DEV_MODE === "true";
}

/**
 * MLS_ENABLED: "true" serves MLS and lets chats move to it. "testers" does the same only for the
 * people in MLS_TESTERS: only they hear MLS is on, and a chat moves only when all its members are
 * testers. "paused" serves the chats already on MLS and moves no others, so it's the way back once
 * any chat has switched. Anything else is off: every /mls route answers 404, which strands a chat
 * that has switched, since it refuses v1. The rules themselves are in @babillard/shared's mlsRollout.
 */
export function mlsMode(env: Env): MlsMode {
  return parseMlsMode(env.MLS_ENABLED);
}

export function mlsTesters(env: Env): MlsTesters {
  return parseMlsTesters(env.MLS_TESTERS);
}

export function avatarUrl(env: Env, key: string | null | undefined): string | null {
  return key ? `${env.PUBLIC_ORIGIN}/avatars/${key}` : null;
}

