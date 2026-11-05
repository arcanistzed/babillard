import { orderedPair, reportSchema } from "@ideas-match/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "../db";
import { fail, parseJson } from "../lib/http";
import { newId } from "../lib/tokens";
import { requireAuth, requireOnboarded } from "../middleware";
import type { AppEnv } from "../types";

const safety = new Hono<AppEnv>();
safety.use("*", requireAuth, requireOnboarded);

safety.post("/reports", async (c) => {
  const user = c.get("user");
  const input = await parseJson(c, reportSchema);
  if (input.targetUserId === user.id) throw fail(400, "cannot_report_self");
  const db = getDb(c.env);
  const [target] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, input.targetUserId));
  if (!target) throw fail(404, "person_not_found");

  await db.insert(schema.reports).values({
    id: newId(),
    reporterId: user.id,
    targetUserId: input.targetUserId,
    conversationId: input.conversationId ?? null,
    messageId: input.messageId ?? null,
    reason: input.reason,
    note: input.note,
    createdAt: Date.now(),
  });
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
