import { openWithContentKey, orderedPair, reportSchema, type ReportEvidence } from "@ideas-match/shared";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "../db";
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
 * Hides both people from each other's cards and cohorts, ends any direct chat
 * between them, and hides the blocked person's messages from the blocker in
 * shared groups. ChatRoom and the message routes apply that last part.
 */
safety.post("/blocks/:userId", async (c) => {
  const user = c.get("user");
  const blockedId = c.req.param("userId");
  if (blockedId === user.id) throw fail(400, "cannot_block_self");
  const db = getDb(c.env);
  const [target] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, blockedId));
  if (!target) throw fail(404, "person_not_found");

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
  return c.json({ ok: true });
});

safety.delete("/blocks/:userId", async (c) => {
  await getDb(c.env)
    .delete(schema.blocks)
    .where(and(eq(schema.blocks.blockerId, c.get("user").id), eq(schema.blocks.blockedId, c.req.param("userId"))));
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
