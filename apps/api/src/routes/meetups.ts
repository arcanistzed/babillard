import { didMeetSchema, isMeetupConfirmed, meetupProposalSchema, meetupResponseSchema, requiredYesCount, type ConversationKind, type MeetupSummary } from "@ideas-match/shared";
import { venueNames } from "../lib/language";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema, type Db } from "../db";
import { fail, parseJson } from "../lib/http";
import { sendPush } from "../lib/push";
import { newId, randomToken } from "../lib/tokens";
import { requireAuth, requireOnboarded } from "../middleware";
import type { AppEnv } from "../types";
import { requireMember } from "./conversations";

type MeetupRow = typeof schema.meetups.$inferSelect;

const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const START_GRACE_MS = 60 * 1000;

async function memberCount(db: Db, conversationId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.conversationMembers)
    .where(eq(schema.conversationMembers.conversationId, conversationId));
  return row?.count ?? 0;
}

async function memberIds(db: Db, conversationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.conversationMembers.userId })
    .from(schema.conversationMembers)
    .where(eq(schema.conversationMembers.conversationId, conversationId));
  return rows.map((row) => row.id);
}

export async function meetupSummaries(env: Env, db: Db, conversationId: string, kind: ConversationKind, userId: string, only?: string): Promise<MeetupSummary[]> {
  const rows = await db
    .select()
    .from(schema.meetups)
    .where(only ? eq(schema.meetups.id, only) : eq(schema.meetups.conversationId, conversationId))
    .orderBy(desc(schema.meetups.createdAt))
    .limit(10);
  if (rows.length === 0) return [];

  const [responses, count] = await Promise.all([
    db.select().from(schema.meetupResponses).where(inArray(schema.meetupResponses.meetupId, rows.map((row) => row.id))),
    memberCount(db, conversationId),
  ]);
  return rows.map((row) => toSummary(env, row, responses, kind, count, userId));
}

function toSummary(env: Env, row: MeetupRow, responses: (typeof schema.meetupResponses.$inferSelect)[], kind: ConversationKind, count: number, userId: string): MeetupSummary {
  const own = responses.filter((response) => response.meetupId === row.id);
  const mine = own.find((response) => response.userId === userId);
  return {
    id: row.id,
    conversationId: row.conversationId,
    proposedBy: row.proposedBy,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    venueKind: row.venueKind,
    venueNote: row.venueNote,
    state: row.state,
    yesCount: own.filter((response) => response.response === "yes").length,
    requiredYes: requiredYesCount(kind, count),
    myResponse: mine?.response ?? null,
    myDidMeet: mine?.didMeet ?? null,
    shareUrl: `${env.PUBLIC_ORIGIN}/m/${row.shareToken}`,
    checkinOpen: row.checkinSentAt !== null,
  };
}

/** Messages name the place only. The server doesn't know the reader's time zone, so the app's meetup card shows the time. */
function venueName(meetup: Pick<MeetupRow, "venueKind" | "venueNote">) {
  return venueNames(meetup);
}

async function loadMeetup(db: Db, id: string, userId: string) {
  const [meetup] = await db.select().from(schema.meetups).where(eq(schema.meetups.id, id));
  if (!meetup) throw fail(404, "meetup_not_found");
  const { conversation } = await requireMember(db, meetup.conversationId, userId).catch(() => {
    throw fail(404, "meetup_not_found");
  });
  return { meetup, conversation };
}

async function summaryFor(env: Env, db: Db, meetup: MeetupRow, kind: ConversationKind, userId: string): Promise<MeetupSummary> {
  const [summary] = await meetupSummaries(env, db, meetup.conversationId, kind, userId, meetup.id);
  return summary!;
}

const meetups = new Hono<AppEnv>();
meetups.use("*", requireAuth, requireOnboarded);

meetups.post("/", async (c) => {
  const user = c.get("user");
  const input = await parseJson(c, meetupProposalSchema);
  const conversationId = c.req.query("conversationId");
  if (!conversationId) throw fail(400, "conversation_required");

  const db = getDb(c.env);
  const { conversation } = await requireMember(db, conversationId, user.id);
  const now = Date.now();
  if (input.startsAt < now - START_GRACE_MS) throw fail(400, "starts_in_the_past");
  if (input.endsAt - input.startsAt > MAX_DURATION_MS) throw fail(400, "too_long");

  const meetup: MeetupRow = {
    id: newId(),
    conversationId,
    proposedBy: user.id,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    venueKind: input.venueKind,
    venueNote: input.venueNote,
    state: "proposed",
    shareToken: randomToken(18),
    reminderSentAt: null,
    checkinSentAt: null,
    createdAt: now,
  };
  await db.batch([
    db.insert(schema.meetups).values(meetup),
    db.insert(schema.meetupResponses).values({ meetupId: meetup.id, userId: user.id, response: "yes", respondedAt: now }),
    // Proposing a meetup is engagement, so a match with one on the table is no longer silent.
    db.update(schema.conversations).set({ lastUserMessageAt: now }).where(eq(schema.conversations.id, conversationId)),
  ]);

  const [profile] = await db.select({ name: schema.profiles.displayName }).from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  const name = profile?.name ?? "Someone";
  await c.env.CHAT_ROOM.getByName(conversationId).postSystem(conversationId, `${name} proposed a meetup at ${venueName(meetup).en}.`, {
    fr: `${profile?.name ?? "Quelqu'un"} a proposé une rencontre : ${venueName(meetup).fr}.`,
    kind: "meetup",
    meetupId: meetup.id,
  });
  const others = (await memberIds(db, conversationId)).filter((id) => id !== user.id);
  c.executionCtx.waitUntil(
    sendPush(c.env, others, { title: `${name} wants to meet`, body: venueName(meetup).en, fr: { title: `${profile?.name ?? "Quelqu'un"} veut vous rencontrer`, body: venueName(meetup).fr }, data: { screen: "meetup", id: meetup.id } }),
  );
  return c.json(await summaryFor(c.env, db, meetup, conversation.kind, user.id), 201);
});

meetups.get("/:id", async (c) => {
  const user = c.get("user");
  const db = getDb(c.env);
  const { meetup, conversation } = await loadMeetup(db, c.req.param("id"), user.id);
  return c.json(await summaryFor(c.env, db, meetup, conversation.kind, user.id));
});

meetups.post("/:id/respond", async (c) => {
  const user = c.get("user");
  const { response } = await parseJson(c, meetupResponseSchema);
  const db = getDb(c.env);
  const { meetup, conversation } = await loadMeetup(db, c.req.param("id"), user.id);
  if (meetup.state === "cancelled" || meetup.state === "done") throw fail(409, "meetup_closed");

  const now = Date.now();
  await db
    .insert(schema.meetupResponses)
    .values({ meetupId: meetup.id, userId: user.id, response, respondedAt: now })
    .onConflictDoUpdate({ target: [schema.meetupResponses.meetupId, schema.meetupResponses.userId], set: { response, respondedAt: now } });

  const [yes] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.meetupResponses)
    .where(and(eq(schema.meetupResponses.meetupId, meetup.id), eq(schema.meetupResponses.response, "yes")));

  const stub = c.env.CHAT_ROOM.getByName(meetup.conversationId);
  const count = await memberCount(db, meetup.conversationId);
  if (meetup.state === "proposed" && isMeetupConfirmed(conversation.kind, yes?.count ?? 0, count)) {
    const confirmed = await db
      .update(schema.meetups)
      .set({ state: "confirmed" })
      .where(and(eq(schema.meetups.id, meetup.id), eq(schema.meetups.state, "proposed")))
      .returning({ id: schema.meetups.id });
    if (confirmed.length > 0) {
      const where = venueName(meetup);
      await stub.postSystem(meetup.conversationId, `It's on! Meetup confirmed at ${where.en}.`, { fr: `C'est confirmé! Rencontre : ${where.fr}.`, kind: "meetup", meetupId: meetup.id });
      console.log(JSON.stringify({ event: "meetup_confirmed", meetupId: meetup.id, conversationKind: conversation.kind }));
      c.executionCtx.waitUntil(
        sendPush(c.env, await memberIds(db, meetup.conversationId), { title: "Your meetup is on", body: where.en, fr: { title: "Votre rencontre est confirmée", body: where.fr }, data: { screen: "meetup", id: meetup.id } }),
      );
    }
  }
  await stub.notifyMeetupChanged(meetup.id);

  const [fresh] = await db.select().from(schema.meetups).where(eq(schema.meetups.id, meetup.id));
  return c.json(await summaryFor(c.env, db, fresh!, conversation.kind, user.id));
});

/** The north-star metric is recorded here: did these people actually meet? */
meetups.post("/:id/did-meet", async (c) => {
  const user = c.get("user");
  const { didMeet } = await parseJson(c, didMeetSchema);
  const db = getDb(c.env);
  const { meetup, conversation } = await loadMeetup(db, c.req.param("id"), user.id);
  if (meetup.checkinSentAt === null) throw fail(409, "checkin_not_open");

  const updated = await db
    .update(schema.meetupResponses)
    .set({ didMeet })
    .where(and(eq(schema.meetupResponses.meetupId, meetup.id), eq(schema.meetupResponses.userId, user.id)))
    .returning({ id: schema.meetupResponses.userId });
  if (updated.length === 0) throw fail(403, "no_response_recorded");
  console.log(JSON.stringify({ event: "did_meet", meetupId: meetup.id, didMeet }));
  return c.json(await summaryFor(c.env, db, meetup, conversation.kind, user.id));
});

meetups.post("/:id/cancel", async (c) => {
  const user = c.get("user");
  const db = getDb(c.env);
  const { meetup, conversation } = await loadMeetup(db, c.req.param("id"), user.id);
  if (meetup.proposedBy !== user.id) throw fail(403, "only_the_proposer_can_cancel");
  if (meetup.state === "cancelled" || meetup.state === "done") throw fail(409, "meetup_closed");

  await db.update(schema.meetups).set({ state: "cancelled" }).where(eq(schema.meetups.id, meetup.id));
  const stub = c.env.CHAT_ROOM.getByName(meetup.conversationId);
  await stub.postSystem(meetup.conversationId, "The meetup was cancelled.", { fr: "La rencontre a été annulée.", kind: "meetup", meetupId: meetup.id });
  await stub.notifyMeetupChanged(meetup.id);
  const [fresh] = await db.select().from(schema.meetups).where(eq(schema.meetups.id, meetup.id));
  return c.json(await summaryFor(c.env, db, fresh!, conversation.kind, user.id));
});

export default meetups;
