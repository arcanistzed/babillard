import { GROUP_MEETUP_CONFIRM_YES, MEETUP_REPEAT_MS, isCheckinDue, isMatchExpired, isNudgeDue, isProposalStale, isReminderDue, pickBilingualOpener } from "@babillard/shared";
import { deleteAccount } from "./lib/accounts";
import { sendEmail } from "./lib/email";
import { releaseExpiredPairs } from "./lib/matches";
import { settleMeetup, withoutBlocksWithAny } from "./lib/meetupState";
import { and, eq, gt, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "./db";
import { jobOffsets, meetupAnnounceCooldownMs } from "./lib/config";
import { venueNames } from "./lib/language";
import { sendPush } from "./lib/push";
import { newId, randomToken } from "./lib/tokens";

const SWEEP_BATCH = 200;

/** Every time-based job lives here. Each step claims a row before notifying, so a retry cannot double-send. */
export async function runSweep(env: Env, now = Date.now()): Promise<void> {
  const db = getDb(env);
  const jobs = { nudgeMatches, expireMatches, settleMeetups, remindMeetups, checkInMeetups, cancelStaleProposals, continueSeries, removeOldRecords, warnInactiveAccounts, deleteInactiveAccounts };
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
    await env.CHAT_ROOM.getByName(match.conversationId).postSystem(match.conversationId, `Still curious? ${opener.en}`, { fr: `Encore envie d'en parler? ${opener.fr}`, unread: true });
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
  // Matches that expired on an earlier sweep stop keeping the pair apart in People.
  await releaseExpiredPairs(db);
  const due = (await silentActiveMatches(db)).filter(({ match, lastUserMessageAt }) => isMatchExpired({ ...match, lastUserMessageAt }, now));
  if (due.length === 0) return 0;
  const expired = await db
    .update(schema.matches)
    .set({ state: "expired" })
    .where(and(inArray(schema.matches.id, due.map(({ match }) => match.id)), eq(schema.matches.state, "active")))
    .returning({ id: schema.matches.id });
  return expired.length;
}

/** People still in the chat who gave one of these answers. Someone who left can't open the meetup anymore. */
async function responders(db: Db, meetup: { id: string; conversationId: string }, answers: ("yes" | "maybe")[]): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.meetupResponses.userId })
    .from(schema.meetupResponses)
    .innerJoin(schema.conversationMembers, and(eq(schema.conversationMembers.userId, schema.meetupResponses.userId), eq(schema.conversationMembers.conversationId, meetup.conversationId)))
    .where(and(eq(schema.meetupResponses.meetupId, meetup.id), inArray(schema.meetupResponses.response, answers)));
  return rows.map((row) => row.userId);
}

// Settling one meetup takes about a dozen database, chat and push calls. Keeping the batch small keeps a sweep well inside
// the Worker's subrequest limit, even right after a deploy that has a backlog to settle. Anything left waits five minutes.
const SETTLE_BATCH = 25;

/**
 * Leaving a group and deleting an account settle meetups straight away. This is the backstop for when that failed,
 * and announces any change that had to wait out the cooldown.
 * Only meetups that need something are loaded, so ones that are fine never fill the batch.
 */
async function settleMeetups(env: Env, db: Db, now: number): Promise<number> {
  const yes = sql<number>`(select count(*) from meetup_responses as yes_r inner join conversation_members as yes_m on yes_m.user_id = yes_r.user_id and yes_m.conversation_id = "meetups"."conversation_id" where yes_r.meetup_id = "meetups"."id" and yes_r.response = 'yes')`;
  const members = sql<number>`(select count(*) from conversation_members as all_m where all_m.conversation_id = "meetups"."conversation_id")`;
  // requiredYesCount in SQL: two in a direct chat, otherwise three or everyone left if fewer.
  const required = sql<number>`(case when "conversations"."kind" = 'direct' then 2 else min(${GROUP_MEETUP_CONFIRM_YES}, max(${members}, 2)) end)`;
  // A one-on-one closed by a block or an ended match, or missing a member, has nobody left to tell.
  const open = sql`("conversations"."kind" = 'group' or (${members} >= 2 and not exists (select 1 from matches as closed_m where closed_m.conversation_id = "meetups"."conversation_id" and closed_m.state != 'active')))`;
  // requiredYesToStayConfirmed in SQL: the same, counting only people who were there when the meetup was proposed.
  const membersAtProposal = sql<number>`(select count(*) from conversation_members as then_m where then_m.conversation_id = "meetups"."conversation_id" and then_m.joined_at <= "meetups"."created_at")`;
  const toStay = sql<number>`(case when "conversations"."kind" = 'direct' then 2 else min(${GROUP_MEETUP_CONFIRM_YES}, max(${membersAtProposal}, 2)) end)`;
  const wrongState = sql`((${schema.meetups.state} = 'confirmed' and ${yes} < ${toStay}) or (${schema.meetups.state} = 'proposed' and ${yes} >= ${required}))`;
  const unannounced = sql`(coalesce(${schema.meetups.announcedState}, 'proposed') != ${schema.meetups.state} and (${schema.meetups.announcedAt} is null or ${schema.meetups.announcedAt} <= ${now - meetupAnnounceCooldownMs(env)}))`;
  const candidates = await db
    .select({ meetup: schema.meetups, kind: schema.conversations.kind })
    .from(schema.meetups)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.meetups.conversationId))
    .where(and(inArray(schema.meetups.state, ["proposed", "confirmed"]), gt(schema.meetups.startsAt, now), open, sql`(${wrongState} or ${unannounced})`))
    .orderBy(schema.meetups.startsAt)
    .limit(SETTLE_BATCH);

  let handled = 0;
  for (const { meetup, kind } of candidates) {
    const settled = await settleMeetup(env, db, meetup, kind, { now });
    if (settled.state !== meetup.state) await env.CHAT_ROOM.getByName(meetup.conversationId).notifyMeetupChanged(meetup.id);
    handled += 1;
  }
  return handled;
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
      .where(and(eq(schema.meetups.id, meetup.id), eq(schema.meetups.state, "confirmed"), isNull(schema.meetups.reminderSentAt)))
      .returning({ id: schema.meetups.id });
    if (claimed.length === 0) continue;
    // The body carries the proposer's venue note.
    await sendPush(env, await withoutBlocksWithAny(db, await responders(db, meetup, ["yes", "maybe"]), [meetup.proposedBy]), {
      title: "Your meetup is coming up",
      body: meetup.venueNote ? `Soon at ${meetup.venueNote}` : "It starts soon.",
      fr: { title: "Votre rencontre approche", body: meetup.venueNote ? `Bientôt à ${meetup.venueNote}` : "Ça commence bientôt." },
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
      .where(and(eq(schema.meetups.id, meetup.id), eq(schema.meetups.state, "confirmed"), isNull(schema.meetups.checkinSentAt)))
      .returning({ id: schema.meetups.id });
    if (claimed.length === 0) continue;
    // The app has been asking since shortly after the meetup ended, so people who already answered there aren't asked again.
    const answered = new Set(
      (await db.select({ userId: schema.meetupResponses.userId }).from(schema.meetupResponses).where(and(eq(schema.meetupResponses.meetupId, meetup.id), isNotNull(schema.meetupResponses.didMeet)))).map((row) => row.userId),
    );
    await sendPush(env, (await responders(db, meetup, ["yes"])).filter((id) => !answered.has(id)), {
      title: "Did you meet?",
      body: "Tell us how it went.",
      fr: { title: "La rencontre a-t-elle eu lieu?", body: "Dites-nous comment ça s'est passé." },
      data: { screen: "meetup", id: meetup.id },
    });
    handled += 1;
  }
  return handled;
}

// Each lapsed meetup that had been on is announced, so this batch is smaller than the others.
const STALE_BATCH = 50;

/**
 * Cancels proposals still unconfirmed at their start time. One that had been confirmed and then lost its yeses
 * may still be in people's plans, so whoever is still at yes or maybe hears that it's off.
 */
async function cancelStaleProposals(env: Env, db: Db, now: number): Promise<number> {
  const candidates = await db
    .select()
    .from(schema.meetups)
    .where(and(eq(schema.meetups.state, "proposed"), lte(schema.meetups.startsAt, now)))
    .limit(STALE_BATCH);
  const stale = candidates.filter((meetup) => isProposalStale(meetup, now));
  if (stale.length === 0) return 0;
  const cancelled = await db
    .update(schema.meetups)
    .set({ state: "cancelled" })
    .where(and(inArray(schema.meetups.id, stale.map((meetup) => meetup.id)), eq(schema.meetups.state, "proposed")))
    .returning({ id: schema.meetups.id });
  const lapsed = new Set(cancelled.map((row) => row.id));
  // announcedState is set only once a meetup has been confirmed, so a proposal that never was stays quiet.
  for (const meetup of stale.filter((row) => lapsed.has(row.id) && row.announcedState !== null)) {
    const where = venueNames(meetup);
    const body = {
      en: `The meetup at ${where.en} is off: it didn't have enough yeses when it was due to start.`,
      fr: `La rencontre est annulée (${where.fr}): il n'y avait pas assez de oui à l'heure prévue.`,
    };
    const stub = env.CHAT_ROOM.getByName(meetup.conversationId);
    await stub.postSystem(meetup.conversationId, body.en, { fr: body.fr, kind: "meetup", meetupId: meetup.id, unread: true });
    await stub.notifyMeetupChanged(meetup.id);
    // The body carries the proposer's venue note.
    await sendPush(env, await withoutBlocksWithAny(db, await responders(db, meetup, ["yes", "maybe"]), [meetup.proposedBy]), {
      title: "Your meetup is off",
      body: body.en,
      fr: { title: "Votre rencontre est annulée", body: body.fr },
      data: { screen: "meetup", id: meetup.id },
    });
  }
  return cancelled.length;
}

/**
 * After a repeating meetup ends, proposes the next date at the same time and place and asks the chat.
 * A date that was cancelled or never confirmed only skips that week, but two in a row end the series,
 * so a group that has gone quiet stops getting proposals.
 */
async function continueSeries(env: Env, db: Db, now: number): Promise<number> {
  const ended = await db
    .select()
    .from(schema.meetups)
    .where(and(inArray(schema.meetups.repeat, ["weekly", "biweekly"]), isNull(schema.meetups.nextMeetupId), lte(schema.meetups.endsAt, now), inArray(schema.meetups.state, ["confirmed", "done", "cancelled"])))
    .limit(SWEEP_BATCH);

  let handled = 0;
  for (const meetup of ended) {
    if (meetup.repeat === "none") continue;
    const stub = env.CHAT_ROOM.getByName(meetup.conversationId);
    const [previous] = await db.select({ state: schema.meetups.state }).from(schema.meetups).where(eq(schema.meetups.nextMeetupId, meetup.id));
    const members = await db.select({ id: schema.conversationMembers.userId }).from(schema.conversationMembers).where(eq(schema.conversationMembers.conversationId, meetup.conversationId));
    if ((meetup.state === "cancelled" && previous?.state === "cancelled") || members.length < 2) {
      const stopped = await db.update(schema.meetups).set({ repeat: "none" }).where(and(eq(schema.meetups.id, meetup.id), isNull(schema.meetups.nextMeetupId))).returning({ id: schema.meetups.id });
      if (stopped.length > 0 && members.length >= 2) {
        await stub.postSystem(meetup.conversationId, "The meetup stopped repeating, since the last two dates didn't happen.", {
          fr: "La rencontre ne se répète plus, puisque les deux dernières dates n'ont pas eu lieu.",
        });
      }
      continue;
    }

    const interval = MEETUP_REPEAT_MS[meetup.repeat];
    let startsAt = meetup.startsAt + interval;
    while (startsAt <= now) startsAt += interval;
    const nextId = newId();
    // Claimed first, so a retried sweep can't propose the same date twice.
    const claimed = await db.update(schema.meetups).set({ nextMeetupId: nextId }).where(and(eq(schema.meetups.id, meetup.id), isNull(schema.meetups.nextMeetupId))).returning({ id: schema.meetups.id });
    if (claimed.length === 0) continue;
    await db.insert(schema.meetups).values({
      id: nextId,
      conversationId: meetup.conversationId,
      proposedBy: meetup.proposedBy,
      startsAt,
      endsAt: startsAt + (meetup.endsAt - meetup.startsAt),
      venueKind: meetup.venueKind,
      venueNote: meetup.venueNote,
      state: "proposed",
      shareToken: randomToken(18),
      guestsWelcome: meetup.guestsWelcome,
      repeat: meetup.repeat,
      createdAt: now,
    });

    const weekly = meetup.repeat === "weekly";
    await stub.postSystem(
      meetup.conversationId,
      weekly ? "Next week's meetup is proposed, same time and place. Are you in?" : "The meetup in two weeks is proposed, same time and place. Are you in?",
      {
        fr: weekly ? "La rencontre de la semaine prochaine est proposée, même heure et même lieu. Vous venez?" : "La rencontre dans deux semaines est proposée, même heure et même lieu. Vous venez?",
        kind: "meetup",
        meetupId: nextId,
        unread: true,
      },
    );
    await sendPush(env, members.map((member) => member.id), {
      title: "Meeting again?",
      body: weekly ? "Next week, same time and place." : "In two weeks, same time and place.",
      fr: { title: "On se revoit?", body: weekly ? "La semaine prochaine, même heure et même lieu." : "Dans deux semaines, même heure et même lieu." },
      data: { screen: "meetup", id: nextId },
    });
    handled += 1;
  }
  return handled;
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
