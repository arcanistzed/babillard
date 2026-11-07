import { sendMessageSchema, visibleLookingFor, type ChatMessage, type ConversationDetail, type InboxItem, type Stance } from "@ideas-match/shared";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb, schema, type Db } from "../db";
import { avatarUrl } from "../lib/config";
import { fail, parseJson } from "../lib/http";
import { requireAuth, requireOnboarded } from "../middleware";
import type { AppEnv } from "../types";
import { meetupSummaries } from "./meetups";

const members = schema.conversationMembers;

export async function requireMember(db: Db, conversationId: string, userId: string) {
  const [row] = await db
    .select({ conversation: schema.conversations, membership: members })
    .from(members)
    .innerJoin(schema.conversations, eq(schema.conversations.id, members.conversationId))
    .where(and(eq(members.conversationId, conversationId), eq(members.userId, userId)));
  if (!row) throw fail(404, "conversation_not_found");
  return row;
}

/** Direct chats close with their match. Returns the match's expiry, or null for a group. */
async function requireOpenMatch(db: Db, conversationId: string): Promise<number | null> {
  const [match] = await db.select().from(schema.matches).where(eq(schema.matches.conversationId, conversationId));
  if (match && match.state !== "active") throw fail(410, "conversation_closed");
  return match?.expiresAt ?? null;
}

const conversations = new Hono<AppEnv>();
conversations.use("*", requireAuth, requireOnboarded);

conversations.get("/", async (c) => {
  const user = c.get("user");
  const db = getDb(c.env);

  const rows = await db
    .select({ conversation: schema.conversations, membership: members, match: schema.matches, topicTitle: schema.topics.title })
    .from(members)
    .innerJoin(schema.conversations, eq(schema.conversations.id, members.conversationId))
    .leftJoin(schema.matches, eq(schema.matches.conversationId, schema.conversations.id))
    .leftJoin(schema.topics, eq(schema.topics.id, schema.conversations.topicId))
    .where(and(eq(members.userId, user.id), or(eq(schema.conversations.kind, "group"), eq(schema.matches.state, "active"))))
    .orderBy(desc(sql`coalesce(${schema.conversations.lastMessageAt}, ${schema.conversations.createdAt})`));
  if (rows.length === 0) return c.json([]);

  const ids = rows.map((row) => row.conversation.id);
  const now = Date.now();
  const [everyone, meetups, myBlocks] = await Promise.all([
    db
      .select({ conversationId: members.conversationId, userId: members.userId, name: schema.profiles.displayName, avatarKey: schema.profiles.avatarKey })
      .from(members)
      .leftJoin(schema.profiles, eq(schema.profiles.userId, members.userId))
      .where(inArray(members.conversationId, ids)),
    db
      .select({ conversationId: schema.meetups.conversationId, startsAt: sql<number>`min(${schema.meetups.startsAt})` })
      .from(schema.meetups)
      .where(and(inArray(schema.meetups.conversationId, ids), eq(schema.meetups.state, "confirmed"), gt(schema.meetups.startsAt, now)))
      .groupBy(schema.meetups.conversationId),
    db.select({ id: schema.blocks.blockedId }).from(schema.blocks).where(eq(schema.blocks.blockerId, user.id)),
  ]);
  const blockedIds = new Set(myBlocks.map((row) => row.id));
  const nextMeetup = new Map(meetups.map((row) => [row.conversationId, row.startsAt]));

  const items: InboxItem[] = rows.map(({ conversation, membership, match, topicTitle }) => {
    const roster = everyone.filter((entry) => entry.conversationId === conversation.id);
    const other = roster.find((entry) => entry.userId !== user.id);
    const isDirect = conversation.kind === "direct";
    const hidePreview = conversation.lastMessageSenderId !== null && blockedIds.has(conversation.lastMessageSenderId);
    return {
      id: conversation.id,
      kind: conversation.kind,
      title: isDirect ? (other?.name ?? "Former member") : (topicTitle ?? "Group"),
      topicTitle,
      avatarUrl: isDirect ? avatarUrl(c.env, other?.avatarKey) : null,
      memberCount: roster.length,
      lastMessagePreview: hidePreview ? null : conversation.lastMessagePreview,
      lastMessageEnvelope: hidePreview ? null : conversation.lastMessageEnvelope,
      lastMessageSenderId: conversation.lastMessageSenderId,
      lastMessageAt: conversation.lastMessageAt,
      unreadCount: membership.unreadCount,
      // The countdown only matters while nobody has written anything.
      expiresAt: match && conversation.lastUserMessageAt === null ? match.expiresAt : null,
      nextMeetupAt: nextMeetup.get(conversation.id) ?? null,
    };
  });
  return c.json(items);
});

conversations.get("/:id", async (c) => {
  const user = c.get("user");
  const db = getDb(c.env);
  const id = c.req.param("id");
  const { conversation, membership } = await requireMember(db, id, user.id);
  const expiresAt = await requireOpenMatch(db, id);

  const [roster, topicRows] = await Promise.all([
    db
      .select({ id: members.userId, displayName: schema.profiles.displayName, avatarKey: schema.profiles.avatarKey })
      .from(members)
      .innerJoin(schema.profiles, eq(schema.profiles.userId, members.userId))
      .where(eq(members.conversationId, id)),
    conversation.topicId ? db.select().from(schema.topics).where(eq(schema.topics.id, conversation.topicId)) : Promise.resolve([]),
  ]);
  const topic = topicRows[0] ?? null;

  let stanceSpread: Record<Stance, number> | null = null;
  if (conversation.kind === "group" && topic?.kind === "question") {
    const rows = await db
      .select({ stance: schema.topicSwipes.stance, count: sql<number>`count(*)` })
      .from(schema.topicSwipes)
      .where(and(eq(schema.topicSwipes.topicId, topic.id), inArray(schema.topicSwipes.userId, roster.map((member) => member.id))))
      .groupBy(schema.topicSwipes.stance);
    stanceSpread = { for: 0, against: 0, unsure: 0 };
    for (const row of rows) if (row.stance) stanceSpread[row.stance] = row.count;
  }

  const devices = await db
    .select({ userId: schema.deviceKeys.userId, publicKey: schema.deviceKeys.publicKey, retiredAt: schema.deviceKeys.retiredAt })
    .from(schema.deviceKeys)
    .where(inArray(schema.deviceKeys.userId, roster.map((member) => member.id)));
  const keysOf = (userId: string, retired: boolean) => devices.filter((device) => device.userId === userId && (device.retiredAt !== null) === retired).map((device) => device.publicKey);
  const memberCards = roster.map((member) => ({
    id: member.id,
    displayName: member.displayName,
    avatarUrl: avatarUrl(c.env, member.avatarKey),
    deviceKeys: keysOf(member.id, false),
    retiredDeviceKeys: keysOf(member.id, true),
  }));
  const other = conversation.kind === "direct" ? memberCards.find((member) => member.id !== user.id) : undefined;
  const detail: ConversationDetail = {
    id,
    kind: conversation.kind,
    title: conversation.kind === "direct" ? (other?.displayName ?? "Former member") : (topic?.title ?? "Group"),
    topic: topic ? { id: topic.id, title: topic.title, kind: topic.kind } : null,
    members: memberCards,
    suggestedOpeners: conversation.lastUserMessageAt === null ? (topic?.openers ?? []) : [],
    stanceSpread,
    meetups: await meetupSummaries(c.env, db, conversation.id, conversation.kind, user.id),
    expiresAt: conversation.lastUserMessageAt === null ? expiresAt : null,
    muted: membership.muted,
  };
  return c.json(detail);
});

conversations.get("/:id/messages", async (c) => {
  const user = c.get("user");
  const db = getDb(c.env);
  const id = c.req.param("id");
  await requireMember(db, id, user.id);
  await requireOpenMatch(db, id);

  const beforeParam = Number(c.req.query("before"));
  const before = Number.isInteger(beforeParam) && beforeParam > 0 ? beforeParam : undefined;
  const stub = c.env.CHAT_ROOM.getByName(id);
  const around = c.req.query("around");
  const history: ChatMessage[] = around !== undefined ? await stub.around(around || null) : await stub.history(before);

  const blocked = await db.select({ id: schema.blocks.blockedId }).from(schema.blocks).where(eq(schema.blocks.blockerId, user.id));
  const blockedIds = new Set(blocked.map((row) => row.id));
  return c.json(history.filter((message) => message.senderId === null || !blockedIds.has(message.senderId)));
});

conversations.post("/:id/messages", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = await parseJson(c, sendMessageSchema);
  const result = await c.env.CHAT_ROOM.getByName(id).trySend(id, user.id, input.envelope, input.clientId);
  if (!result.ok) throw fail(result.error === "stale_keys" || result.error === "unknown_device" ? 409 : 403, result.error);
  return c.json(result.message, 201);
});

conversations.post("/:id/read", async (c) => {
  const user = c.get("user");
  await getDb(c.env)
    .update(members)
    .set({ unreadCount: 0, lastReadAt: Date.now() })
    .where(and(eq(members.conversationId, c.req.param("id")), eq(members.userId, user.id)));
  return c.json({ ok: true });
});

conversations.post("/:id/mute", async (c) => {
  const user = c.get("user");
  const { muted } = await parseJson(c, z.object({ muted: z.boolean() }));
  await getDb(c.env)
    .update(members)
    .set({ muted })
    .where(and(eq(members.conversationId, c.req.param("id")), eq(members.userId, user.id)));
  return c.json({ muted });
});

conversations.post("/:id/leave", async (c) => {
  const user = c.get("user");
  const db = getDb(c.env);
  const id = c.req.param("id");
  const { conversation } = await requireMember(db, id, user.id);
  if (conversation.kind !== "group") throw fail(400, "only_groups_can_be_left");

  await db.delete(members).where(and(eq(members.conversationId, id), eq(members.userId, user.id)));
  const stub = c.env.CHAT_ROOM.getByName(id);
  await stub.kick(user.id);
  const [profile] = await db.select({ name: schema.profiles.displayName }).from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  await stub.postSystem(id, `${profile?.name ?? "Someone"} left the group.`);
  return c.json({ ok: true });
});

conversations.get("/:id/ws", async (c) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") throw fail(426, "websocket_required");
  const user = c.get("user");
  const db = getDb(c.env);
  const id = c.req.param("id");
  await requireMember(db, id, user.id);
  await requireOpenMatch(db, id);

  const headers = new Headers(c.req.raw.headers);
  headers.delete("authorization");
  headers.set("x-user-id", user.id);
  headers.set("x-conversation-id", id);
  return c.env.CHAT_ROOM.getByName(id).fetch(new Request(c.req.raw.url, { headers }));
});

/** Another member's public profile, reached from a chat. */
conversations.get("/:id/members/:userId", async (c) => {
  const user = c.get("user");
  const db = getDb(c.env);
  const id = c.req.param("id");
  await requireMember(db, id, user.id);
  await requireMember(db, id, c.req.param("userId"));

  const [[profile], [mine], [target]] = await Promise.all([
    db.select().from(schema.profiles).where(eq(schema.profiles.userId, c.req.param("userId"))),
    db.select({ lookingFor: schema.profiles.lookingFor }).from(schema.profiles).where(eq(schema.profiles.userId, user.id)),
    db.select({ verified: schema.users.verifiedInstitution }).from(schema.users).where(eq(schema.users.id, c.req.param("userId"))),
  ]);
  if (!profile) throw fail(404, "person_not_found");
  return c.json({
    id: profile.userId,
    displayName: profile.displayName,
    bio: profile.bio,
    role: profile.role,
    avatarUrl: avatarUrl(c.env, profile.avatarKey),
    verifiedInstitution: target?.verified ?? false,
    fields: profile.fields,
    lookingFor: visibleLookingFor(profile.lookingFor, mine?.lookingFor ?? []),
  });
});

export default conversations;
