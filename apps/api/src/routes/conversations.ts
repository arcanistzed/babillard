import { ageOn, isCheckinPromptDue, sendMessageSchema, visibleLookingFor, type ChatMessage, type ConversationDetail, type InboxItem } from "@babillard/shared";
import { localizeTopic, requestLanguage } from "../lib/language";
import { and, desc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb, schema, type Db } from "../db";
import { blockedWith, blockedWithAmong, blocksBetween } from "../lib/blocks";
import { requeueAfterLeaving, savedStanceSpread } from "../lib/cohorts";
import { avatarUrl, jobOffsets } from "../lib/config";
import { fail, parseJson } from "../lib/http";
import { settleUpcomingMeetups } from "../lib/meetupState";
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
    .select({ conversation: schema.conversations, membership: members, match: schema.matches, topicTitle: schema.topics.title, topicFr: schema.topics.fr })
    .from(members)
    .innerJoin(schema.conversations, eq(schema.conversations.id, members.conversationId))
    .leftJoin(schema.matches, eq(schema.matches.conversationId, schema.conversations.id))
    .leftJoin(schema.topics, eq(schema.topics.id, schema.conversations.topicId))
    .where(and(eq(members.userId, user.id), or(eq(schema.conversations.kind, "group"), eq(schema.matches.state, "active"))))
    .orderBy(desc(sql`coalesce(${schema.conversations.lastMessageAt}, ${schema.conversations.createdAt})`));
  if (rows.length === 0) return c.json([]);

  const ids = rows.map((row) => row.conversation.id);
  const now = Date.now();
  const [everyone, meetups, myBlocks, ended] = await Promise.all([
    db
      .select({ conversationId: members.conversationId, userId: members.userId, name: schema.profiles.displayName, avatarKey: schema.profiles.avatarKey })
      .from(members)
      .leftJoin(schema.profiles, eq(schema.profiles.userId, members.userId))
      .where(inArray(members.conversationId, ids)),
    db
      .select({ conversationId: schema.meetups.conversationId, startsAt: sql<number>`min(${schema.meetups.startsAt})` })
      .from(schema.meetups)
      .where(
        and(
          inArray(schema.meetups.conversationId, ids),
          eq(schema.meetups.state, "confirmed"),
          gt(schema.meetups.startsAt, now),
          // Someone who said they can't make it isn't meeting anyone, even if the others still are.
          sql`not exists (select 1 from meetup_responses as mine where mine.meetup_id = "meetups"."id" and mine.user_id = ${user.id} and mine.response = 'no')`,
        ),
      )
      .groupBy(schema.meetups.conversationId),
    blockedWith(db, user.id),
    // Each chat's most recent meetup that went ahead and has ended, with this person's answers.
    db
      .select({
        id: schema.meetups.id,
        conversationId: schema.meetups.conversationId,
        startsAt: schema.meetups.startsAt,
        endsAt: schema.meetups.endsAt,
        state: schema.meetups.state,
        checkinSentAt: schema.meetups.checkinSentAt,
        myResponse: schema.meetupResponses.response,
        myDidMeet: schema.meetupResponses.didMeet,
      })
      .from(schema.meetups)
      .leftJoin(schema.meetupResponses, and(eq(schema.meetupResponses.meetupId, schema.meetups.id), eq(schema.meetupResponses.userId, user.id)))
      .where(
        and(
          inArray(schema.meetups.conversationId, ids),
          inArray(schema.meetups.state, ["confirmed", "done"]),
          lte(schema.meetups.endsAt, now),
          sql`${schema.meetups.endsAt} = (select max(last_m.ends_at) from meetups as last_m where last_m.conversation_id = "meetups"."conversation_id" and last_m.state in ('confirmed', 'done') and last_m.ends_at <= ${now})`,
        ),
      ),
  ]);
  const blockedIds = myBlocks;
  const nextMeetup = new Map(meetups.map((row) => [row.conversationId, row.startsAt]));
  const lastEnded = new Map(ended.map((row) => [row.conversationId, row]));
  const offsets = jobOffsets(c.env);

  const language = requestLanguage(c);
  const items: InboxItem[] = rows.map(({ conversation, membership, match, topicTitle: englishTitle, topicFr }) => {
    const topicTitle = language === "fr" && topicFr ? topicFr.title : englishTitle;
    const roster = everyone.filter((entry) => entry.conversationId === conversation.id);
    const other = roster.find((entry) => entry.userId !== user.id);
    const isDirect = conversation.kind === "direct";
    const hidePreview = conversation.lastMessageSenderId !== null && blockedIds.has(conversation.lastMessageSenderId);
    const past = lastEnded.get(conversation.id);
    const checkin = past && isCheckinPromptDue({ ...past, myResponse: past.myResponse ?? null, myDidMeet: past.myDidMeet ?? null }, now, offsets) ? { meetupId: past.id, startsAt: past.startsAt } : null;
    // An app message from before the meetup ended, such as "It's on!", is out of date once it's over.
    const stale = past !== undefined && conversation.lastMessageEnvelope === null && conversation.lastMessagePreview !== null && (conversation.lastMessageAt ?? 0) < past.endsAt;
    const passed = checkin ? { en: "Did you meet?", fr: "Vous êtes-vous rencontrés?" } : { en: "The meetup has passed.", fr: "La rencontre est passée." };
    return {
      id: conversation.id,
      kind: conversation.kind,
      title: isDirect ? (other?.name ?? "Former member") : (topicTitle ?? "Group"),
      topicTitle,
      avatarUrl: isDirect ? avatarUrl(c.env, other?.avatarKey) : null,
      memberCount: roster.length,
      lastMessagePreview: hidePreview
        ? null
        : stale
          ? passed[language === "fr" ? "fr" : "en"]
          : language === "fr"
            ? (conversation.lastMessagePreviewFr ?? conversation.lastMessagePreview)
            : conversation.lastMessagePreview,
      lastMessageEnvelope: hidePreview ? null : conversation.lastMessageEnvelope,
      lastMessageSenderId: hidePreview ? null : conversation.lastMessageSenderId,
      lastMessageAt: conversation.lastMessageAt,
      unreadCount: membership.unreadCount,
      // The countdown only matters while nobody has written anything.
      expiresAt: match && conversation.lastUserMessageAt === null ? match.expiresAt : null,
      nextMeetupAt: nextMeetup.get(conversation.id) ?? null,
      checkin,
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

  const [roster, topicRows, blocks] = await Promise.all([
    db
      .select({ id: members.userId, displayName: schema.profiles.displayName, avatarKey: schema.profiles.avatarKey })
      .from(members)
      .innerJoin(schema.profiles, eq(schema.profiles.userId, members.userId))
      .where(eq(members.conversationId, id)),
    conversation.topicId ? db.select().from(schema.topics).where(eq(schema.topics.id, conversation.topicId)) : Promise.resolve([]),
    db.select().from(schema.blocks).where(or(eq(schema.blocks.blockerId, user.id), eq(schema.blocks.blockedId, user.id))),
  ]);
  const topic = topicRows[0] ?? null;
  const localized = topic && localizeTopic(topic, requestLanguage(c));

  const stanceSpread = await savedStanceSpread(c.env, conversation, topic);

  const devices = await db
    .select({ userId: schema.deviceKeys.userId, publicKey: schema.deviceKeys.publicKey, retiredAt: schema.deviceKeys.retiredAt })
    .from(schema.deviceKeys)
    .where(inArray(schema.deviceKeys.userId, roster.map((member) => member.id)));
  const keysOf = (userId: string, retired: boolean) => devices.filter((device) => device.userId === userId && (device.retiredAt !== null) === retired).map((device) => device.publicKey);
  // Members with a block either way stay listed, because phones encrypt for every member's devices.
  // Someone who blocked the viewer has their photo left out, and the blocker's app is told whom they blocked.
  const iBlocked = new Set(blocks.filter((row) => row.blockerId === user.id).map((row) => row.blockedId));
  const blockedMe = new Set(blocks.filter((row) => row.blockedId === user.id).map((row) => row.blockerId));
  const memberCards = roster.map((member) => ({
    id: member.id,
    displayName: member.displayName,
    avatarUrl: blockedMe.has(member.id) ? null : avatarUrl(c.env, member.avatarKey),
    deviceKeys: keysOf(member.id, false),
    retiredDeviceKeys: keysOf(member.id, true),
    ...(iBlocked.has(member.id) ? { blockedByMe: true } : {}),
  }));
  const other = conversation.kind === "direct" ? memberCards.find((member) => member.id !== user.id) : undefined;
  const detail: ConversationDetail = {
    id,
    kind: conversation.kind,
    title: conversation.kind === "direct" ? (other?.displayName ?? "Former member") : (localized?.title ?? "Group"),
    topic: topic ? { id: topic.id, title: localized!.title, kind: topic.kind } : null,
    members: memberCards,
    suggestedOpeners: conversation.lastUserMessageAt === null ? (localized?.openers ?? []) : [],
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
  // A block in either direction hides each person's messages from the other. The report screen
  // asks for one person's messages back with `reporting`, so a report about them carries what they
  // said rather than only what bystanders said. That only applies when the reader's own block is
  // the one hiding them: if the other person blocked the reader, blocking them back must not undo it.
  const reporting = around !== undefined ? c.req.query("reporting") : undefined;
  const between = reporting ? await blocksBetween(db, [user.id, reporting]) : [];
  const iBlocked = between.some(([blocker, blocked]) => blocker === user.id && blocked === reporting);
  const theyBlocked = between.some(([blocker, blocked]) => blocker === reporting && blocked === user.id);
  const hidden = [...(await blockedWith(db, user.id))].filter((id) => !(iBlocked && !theyBlocked && id === reporting));
  const history: ChatMessage[] = around !== undefined ? await stub.around(around || null, undefined, hidden) : await stub.history(before, undefined, hidden);
  return c.json(history);
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
  await stub.postSystem(id, `${profile?.name ?? "Someone"} left the group.`, { fr: `${profile?.name ?? "Quelqu'un"} a quitté le groupe.` });
  // Their yes stops counting now, so a meetup that needed it goes back to proposed without waiting for the sweep.
  await settleUpcomingMeetups(c.env, db, id, { waitUntil: (promise) => c.executionCtx.waitUntil(promise) });
  await requeueAfterLeaving(c.env, conversation, user.id);
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
  // Sharing a group doesn't let either side of a block see the other's profile.
  if ((await blockedWithAmong(db, user.id, [c.req.param("userId")])).size) throw fail(404, "person_not_found");

  const [[profile], [mine], [target]] = await Promise.all([
    db.select().from(schema.profiles).where(eq(schema.profiles.userId, c.req.param("userId"))),
    db.select({ lookingFor: schema.profiles.lookingFor }).from(schema.profiles).where(eq(schema.profiles.userId, user.id)),
    db.select({ verified: schema.users.verifiedInstitution, dob: schema.users.dob }).from(schema.users).where(eq(schema.users.id, c.req.param("userId"))),
  ]);
  if (!profile) throw fail(404, "person_not_found");
  return c.json({
    id: profile.userId,
    displayName: profile.displayName,
    age: target?.dob ? ageOn(target.dob) : null,
    bio: profile.bio,
    role: profile.role,
    avatarUrl: avatarUrl(c.env, profile.avatarKey),
    verifiedInstitution: target?.verified ?? false,
    fields: profile.fields,
    lookingFor: visibleLookingFor(profile.lookingFor, mine?.lookingFor ?? []),
  });
});

export default conversations;
