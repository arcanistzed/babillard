import { openWithContentKey, orderedPair, reportSchema, type BlockResult, type ReportEvidence, type SharedGroup } from "@babillard/shared";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { getDb, schema } from "../db";
import { releaseUnblockedTombstones } from "../lib/blocks";
import { requestLanguage } from "../lib/language";
import { fail, parseJson } from "../lib/http";
import { notifyAdminOfReport } from "../lib/moderation";
import { newId } from "../lib/tokens";
import { requireAuth, requireOnboarded } from "../middleware";
import type { AppEnv } from "../types";

const MAX_REPORTS_PER_DAY = 10;
const DAY = 24 * 60 * 60 * 1000;

const safety = new Hono<AppEnv>();
safety.use("*", requireAuth, requireOnboarded);

safety.post("/reports", async (c) => {
  const user = c.get("user");
  const input = await parseJson(c, reportSchema);
  if (input.targetUserId === user.id) throw fail(400, "cannot_report_self");
  const db = getDb(c.env);
  const [target] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, input.targetUserId));
  if (!target) throw fail(404, "person_not_found");

  // Each report emails the admin, so this also keeps one person from flooding that inbox.
  const [recent] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.reports)
    .where(and(eq(schema.reports.reporterId, user.id), gt(schema.reports.createdAt, Date.now() - DAY)));
  if ((recent?.count ?? 0) >= MAX_REPORTS_PER_DAY) throw fail(429, "too_many_reports");

  // The reporter's phone supplies the keys, and the stored ciphertext proves the text is what was really sent.
  const evidence: ReportEvidence[] = [];
  if (input.conversationId && input.evidence.length) {
    const conversationId = input.conversationId;
    const [member] = await db
      .select({ id: schema.conversationMembers.userId })
      .from(schema.conversationMembers)
      .where(and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.userId, user.id)));
    if (!member) throw fail(404, "conversation_not_found");
    const stored = await c.env.CHAT_ROOM.getByName(conversationId).getMessages(input.evidence.map((item) => item.messageId));
    for (const item of input.evidence) {
      const message = stored.find((row) => row.id === item.messageId);
      if (!message?.envelope || !message.senderId) continue;
      const body = openWithContentKey(message.envelope, conversationId, message.senderId, item.contentKey);
      if (body !== null) evidence.push({ id: message.id, senderId: message.senderId, body, createdAt: message.createdAt });
    }
    evidence.sort((a, b) => a.createdAt - b.createdAt);
    // Messages only from other people say nothing about this person and expose bystanders, so they aren't kept.
    if (!evidence.some((item) => item.senderId === input.targetUserId)) evidence.length = 0;
  }

  await db.insert(schema.reports).values({
    id: newId(),
    reporterId: user.id,
    targetUserId: input.targetUserId,
    conversationId: input.conversationId ?? null,
    messageId: input.messageId ?? null,
    reason: input.reason,
    note: input.note,
    evidence,
    createdAt: Date.now(),
  });
  c.executionCtx.waitUntil(notifyAdminOfReport(c.env, input.reason));
  return c.json({ ok: true }, 201);
});

/**
 * Hides both people from each other's cards and cohorts, and ends any direct chat
 * between them. In groups they share, neither is sent the other's messages or can
 * open the other's profile. ChatRoom and the conversation routes apply that part.
 * Meetups belong to the whole group, so the response lists the shared groups and
 * the app offers to leave them.
 */
safety.post("/blocks/:userId", async (c) => {
  const user = c.get("user");
  const blockedId = c.req.param("userId");
  if (blockedId === user.id) throw fail(400, "cannot_block_self");
  const db = getDb(c.env);
  const [target] = await db.select({ id: schema.users.id, status: schema.users.status }).from(schema.users).where(eq(schema.users.id, blockedId));
  // A deleted account has nobody behind it, and a block on it would never reach them if they came back.
  if (!target || target.status === "deleted") throw fail(404, "person_not_found");

  await db.insert(schema.blocks).values({ blockerId: user.id, blockedId, createdAt: Date.now() }).onConflictDoNothing();

  const [userA, userB] = orderedPair(user.id, blockedId);
  const [match] = await db.select().from(schema.matches).where(and(eq(schema.matches.userA, userA), eq(schema.matches.userB, userB)));
  if (match) {
    await db.batch([
      db.update(schema.matches).set({ state: "closed" }).where(eq(schema.matches.id, match.id)),
      db
        .delete(schema.conversationMembers)
        .where(and(eq(schema.conversationMembers.conversationId, match.conversationId), eq(schema.conversationMembers.userId, user.id))),
    ]);
    const stub = c.env.CHAT_ROOM.getByName(match.conversationId);
    await Promise.all([stub.kick(user.id), stub.kick(blockedId)]);
  }

  const theirs = alias(schema.conversationMembers, "theirs");
  const shared = await db
    .select({ id: schema.conversations.id, title: schema.topics.title, fr: schema.topics.fr })
    .from(schema.conversationMembers)
    .innerJoin(theirs, and(eq(theirs.conversationId, schema.conversationMembers.conversationId), eq(theirs.userId, blockedId)))
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.conversationMembers.conversationId))
    .leftJoin(schema.topics, eq(schema.topics.id, schema.conversations.topicId))
    .where(and(eq(schema.conversationMembers.userId, user.id), eq(schema.conversations.kind, "group")));
  const french = requestLanguage(c) === "fr";
  const sharedGroups: SharedGroup[] = shared.map((row) => ({ id: row.id, title: (french ? row.fr?.title : undefined) ?? row.title ?? (french ? "Groupe" : "Group") }));
  return c.json({ ok: true, sharedGroups } satisfies BlockResult);
});

safety.delete("/blocks/:userId", async (c) => {
  const db = getDb(c.env);
  const blockedId = c.req.param("userId");
  await db.delete(schema.blocks).where(and(eq(schema.blocks.blockerId, c.get("user").id), eq(schema.blocks.blockedId, blockedId)));
  await releaseUnblockedTombstones(db, [blockedId]);
  return c.json({ ok: true });
});

safety.get("/blocks", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select({ id: schema.blocks.blockedId }).from(schema.blocks).where(eq(schema.blocks.blockerId, c.get("user").id));
  if (rows.length === 0) return c.json([]);
  const profiles = await db
    .select({ id: schema.profiles.userId, displayName: schema.profiles.displayName })
    .from(schema.profiles)
    .where(inArray(schema.profiles.userId, rows.map((row) => row.id)));
  return c.json(profiles);
});

export default safety;
