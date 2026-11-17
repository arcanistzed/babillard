import { DEFAULT_JOB_OFFSETS, type JobOffsets } from "@babillard/shared";

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
 * MLS_ENABLED: "true" serves MLS and lets chats move to it. "paused" serves the chats already on
 * MLS and moves no others, so it's the way back once any chat has switched. Anything else is off:
 * every /mls route answers 404, which strands a chat that has switched, since it refuses v1.
 */
export type MlsMode = "on" | "paused" | "off";

export function mlsMode(env: Env): MlsMode {
  if (env.MLS_ENABLED === "true") return "on";
  if (env.MLS_ENABLED === "paused") return "paused";
  return "off";
}

export function avatarUrl(env: Env, key: string | null | undefined): string | null {
  return key ? `${env.PUBLIC_ORIGIN}/avatars/${key}` : null;
}

