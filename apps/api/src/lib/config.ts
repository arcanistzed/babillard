import { DEFAULT_JOB_OFFSETS, type JobOffsets } from "@ideas-match/shared";

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

export function avatarUrl(env: Env, key: string | null | undefined): string | null {
  return key ? `${env.PUBLIC_ORIGIN}/avatars/${key}` : null;
}

/**
 * The visitor's IP, for rate limits. Requests through the danielthorp.com front
 * Worker arrive from Cloudflare's own address, so that Worker passes the real one
 * along with a shared key. Without the key, the header is ignored.
 */
export function clientIp(env: Env, header: (name: string) => string | undefined): string {
  const forwarded = header("x-client-ip");
  if (forwarded && env.PROXY_KEY && header("x-proxy-key") === env.PROXY_KEY) return forwarded;
  return header("cf-connecting-ip") ?? "unknown";
}

/** Admin pages stay on the API's own hostname, where Cloudflare Access guards them. */
export function adminOrigin(env: Env): string {
  return env.ADMIN_ORIGIN || env.PUBLIC_ORIGIN;
}
