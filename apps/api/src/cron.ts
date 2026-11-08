import { isCheckinDue, isMatchExpired, isNudgeDue, isProposalStale, isReminderDue, pickBilingualOpener } from "@babillard/shared";
import { deleteAccount } from "./lib/accounts";
import { sendEmail } from "./lib/email";
import { and, eq, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "./db";
import { jobOffsets } from "./lib/config";
import { sendPush } from "./lib/push";

const SWEEP_BATCH = 200;

/** Every time-based job lives here. Each step claims a row before notifying, so a retry cannot double-send. */
export async function runSweep(env: Env, now = Date.now()): Promise<void> {
  const db = getDb(env);
  const jobs = { nudgeMatches, expireMatches, remindMeetups, checkInMeetups, cancelStaleProposals, removeOldRecords, warnInactiveAccounts, deleteInactiveAccounts };
  for (const [name, job] of Object.entries(jobs)) {
    try {
      const handled = await job(env, db, now);
      console.log(JSON.stringify({ event: "sweep", job: name, handled }));
    } catch (error) {
      console.error(JSON.stringify({ event: "sweep_error", job: name, error: String(error) }));
    }
  }
}

function silentActiveMatches(db: Db) {
  return db
    .select({ match: schema.matches, lastUserMessageAt: schema.conversations.lastUserMessageAt })
    .from(schema.matches)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.matches.conversationId))
    .where(and(eq(schema.matches.state, "active"), isNull(schema.conversations.lastUserMessageAt)))
    .limit(SWEEP_BATCH);
}

async function nudgeMatches(env: Env, db: Db, now: number): Promise<number> {
  const offsets = jobOffsets(env);
  let handled = 0;
  for (const { match, lastUserMessageAt } of await silentActiveMatches(db)) {
    if (!isNudgeDue({ ...match, lastUserMessageAt }, now, offsets)) continue;
    const claimed = await db
      .update(schema.matches)
      .set({ nudgedAt: now })
      .where(and(eq(schema.matches.id, match.id), isNull(schema.matches.nudgedAt)))
      .returning({ id: schema.matches.id });
    if (claimed.length === 0) continue;

    const [topic] = match.topicId ? await db.select().from(schema.topics).where(eq(schema.topics.id, match.topicId)) : [];
    const opener = pickBilingualOpener(topic);
    await env.CHAT_ROOM.getByName(match.conversationId).postSystem(match.conversationId, `Still curious? ${opener.en}`, { fr: `Encore envie d'en parler? ${opener.fr}` });
    await sendPush(env, [match.userA, match.userB], {
      title: "Your match is about to expire",
      body: `Two days left to say hi. ${opener.en}`,
      fr: { title: "Votre jumelage expire bientôt", body: `Il reste deux jours pour dire bonjour. ${opener.fr}` },
      data: { screen: "chat", id: match.conversationId },
    });
    handled += 1;
  }
  return handled;
}

async function expireMatches(_env: Env, db: Db, now: number): Promise<number> {
  const due = (await silentActiveMatches(db)).filter(({ match, lastUserMessageAt }) => isMatchExpired({ ...match, lastUserMessageAt }, now));
  if (due.length === 0) return 0;
  const expired = await db
    .update(schema.matches)
    .set({ state: "expired" })
    .where(and(inArray(schema.matches.id, due.map(({ match }) => match.id)), eq(schema.matches.state, "active")))
    .returning({ id: schema.matches.id });
  return expired.length;
}

async function responders(db: Db, meetupId: string, answers: ("yes" | "maybe")[]): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.meetupResponses.userId })
    .from(schema.meetupResponses)
    .where(and(eq(schema.meetupResponses.meetupId, meetupId), inArray(schema.meetupResponses.response, answers)));
  return rows.map((row) => row.userId);
}

async function remindMeetups(env: Env, db: Db, now: number): Promise<number> {
  const offsets = jobOffsets(env);
  const candidates = await db
    .select()
    .from(schema.meetups)
    .where(and(eq(schema.meetups.state, "confirmed"), isNull(schema.meetups.reminderSentAt), lte(schema.meetups.startsAt, now + offsets.meetupReminderLeadMs)))
    .limit(SWEEP_BATCH);

  let handled = 0;
  for (const meetup of candidates) {
    if (!isReminderDue(meetup, now, offsets)) continue;
    const claimed = await db
      .update(schema.meetups)
      .set({ reminderSentAt: now })
      .where(and(eq(schema.meetups.id, meetup.id), isNull(schema.meetups.reminderSentAt)))
      .returning({ id: schema.meetups.id });
    if (claimed.length === 0) continue;
    await sendPush(env, await responders(db, meetup.id, ["yes", "maybe"]), {
      title: "Your meetup is coming up",
      body: meetup.venueNote ? `Soon at ${meetup.venueNote}` : "It starts soon. See you there.",
      fr: { title: "Votre rencontre approche", body: meetup.venueNote ? `Bientôt à ${meetup.venueNote}` : "Ça commence bientôt. À tout de suite." },
      data: { screen: "meetup", id: meetup.id },
    });
    handled += 1;
  }
  return handled;
}

async function checkInMeetups(env: Env, db: Db, now: number): Promise<number> {
  const offsets = jobOffsets(env);
  const candidates = await db
    .select()
    .from(schema.meetups)
    .where(and(eq(schema.meetups.state, "confirmed"), isNull(schema.meetups.checkinSentAt), lte(schema.meetups.endsAt, now - offsets.meetupCheckinDelayMs)))
    .limit(SWEEP_BATCH);

  let handled = 0;
  for (const meetup of candidates) {
    if (!isCheckinDue(meetup, now, offsets)) continue;
    const claimed = await db
      .update(schema.meetups)
      .set({ checkinSentAt: now, state: "done" })
      .where(and(eq(schema.meetups.id, meetup.id), isNull(schema.meetups.checkinSentAt)))
      .returning({ id: schema.meetups.id });
    if (claimed.length === 0) continue;
    await sendPush(env, await responders(db, meetup.id, ["yes"]), {
      title: "Did you meet?",
      body: "Tell us how it went.",
      fr: { title: "Vous êtes-vous rencontrés?", body: "Dites-nous comment ça s'est passé." },
      data: { screen: "meetup", id: meetup.id },
    });
    handled += 1;
  }
  return handled;
}

async function cancelStaleProposals(_env: Env, db: Db, now: number): Promise<number> {
  const candidates = await db
    .select()
    .from(schema.meetups)
    .where(and(eq(schema.meetups.state, "proposed"), lte(schema.meetups.startsAt, now)))
    .limit(SWEEP_BATCH);
  const stale = candidates.filter((meetup) => isProposalStale(meetup, now));
  if (stale.length === 0) return 0;
  await db.update(schema.meetups).set({ state: "cancelled" }).where(inArray(schema.meetups.id, stale.map((meetup) => meetup.id)));
  return stale.length;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MODERATION_RETENTION_MS = 730 * DAY_MS;

async function removeOldRecords(_env: Env, db: Db, now: number): Promise<number> {
  const results = await db.batch([
    db.delete(schema.magicLinks).where(lt(schema.magicLinks.createdAt, now - DAY_MS)).returning({ id: schema.magicLinks.id }),
    db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now)).returning({ id: schema.sessions.id }),
    db.delete(schema.clientErrors).where(lt(schema.clientErrors.createdAt, now - 30 * DAY_MS)).returning({ id: schema.clientErrors.id }),
    // An open report stays until someone handles it, however old it gets.
    db.delete(schema.reports).where(lt(schema.reports.resolvedAt, now - MODERATION_RETENTION_MS)).returning({ id: schema.reports.id }),
    db.delete(schema.moderationLog).where(lt(schema.moderationLog.createdAt, now - MODERATION_RETENTION_MS)).returning({ id: schema.moderationLog.id }),
  ]);
  return results.reduce((total, rows) => total + rows.length, 0);
}

const INACTIVE_AFTER_MS = 730 * DAY_MS;
const INACTIVITY_NOTICE_MS = 30 * DAY_MS;
// Small batches keep a sweep short. Anything left waits for the next one, five minutes later.
const INACTIVITY_BATCH = 25;

const lastUsed = sql`coalesce(${schema.users.lastActiveAt}, ${schema.users.createdAt})`;

async function warnInactiveAccounts(env: Env, db: Db, now: number): Promise<number> {
  const due = await db
    .select({ id: schema.users.id, email: schema.users.email, language: schema.users.language })
    .from(schema.users)
    .where(and(eq(schema.users.status, "active"), isNull(schema.users.inactivityWarnedAt), lt(lastUsed, now - INACTIVE_AFTER_MS + INACTIVITY_NOTICE_MS)))
    .limit(INACTIVITY_BATCH);
  for (const user of due) {
    const french = user.language === "fr";
    const text = french
      ? "Vous n'avez pas utilisé Babillard depuis presque deux ans. Nous supprimerons donc votre compte et vos renseignements dans 30 jours. Pour garder votre compte, ouvrez l'application et connectez-vous."
      : "You haven't used Babillard in almost two years, so we'll delete your account and your information in 30 days. To keep your account, open the app and sign in.";
    const subject = french ? "Votre compte Babillard sera supprimé dans 30 jours" : "Your Babillard account will be deleted in 30 days";
    await sendEmail(env, { to: user.email, subject, text, html: `<p>${text}</p>` });
    await db.update(schema.users).set({ inactivityWarnedAt: now }).where(eq(schema.users.id, user.id));
  }
  return due.length;
}

async function deleteInactiveAccounts(env: Env, db: Db, now: number): Promise<number> {
  const due = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.status, "active"), isNotNull(schema.users.inactivityWarnedAt), lt(schema.users.inactivityWarnedAt, now - INACTIVITY_NOTICE_MS), lt(lastUsed, now - INACTIVE_AFTER_MS)))
    .limit(INACTIVITY_BATCH);
  for (const user of due) await deleteAccount(env, user.id);
  return due.length;
}
