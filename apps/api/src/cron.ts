import { isCheckinDue, isMatchExpired, isNudgeDue, isProposalStale, isReminderDue, pickOpener } from "@ideas-match/shared";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { getDb, schema, type Db } from "./db";
import { jobOffsets } from "./lib/config";
import { sendPush } from "./lib/push";

const SWEEP_BATCH = 200;

/** Every time-based job lives here. Each step claims a row before notifying, so a retry cannot double-send. */
export async function runSweep(env: Env, now = Date.now()): Promise<void> {
  const db = getDb(env);
  const jobs = { nudgeMatches, expireMatches, remindMeetups, checkInMeetups, cancelStaleProposals };
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
    const opener = pickOpener(topic?.openers ?? []);
    await env.CHAT_ROOM.getByName(match.conversationId).postSystem(match.conversationId, `Still curious? ${opener}`);
    await sendPush(env, [match.userA, match.userB], {
      title: "Your match is about to expire",
      body: `Two days left to say hi. ${opener}`,
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
      body: "Tap to let us know how it went.",
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
