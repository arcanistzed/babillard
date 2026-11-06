import { topicPhrase, isMutualMatch, matchExpiresAt, matchOpenerMessage, orderedPair, peopleSwipeSchema, pickOpener, rankPeople, visibleLookingFor, type Field, type LookingFor, type PeopleSwipeResult, type PersonCard, type Role } from "@ideas-match/shared";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema, type Db } from "../db";
import { blockedWith } from "../lib/blocks";
import { avatarUrl, jobOffsets } from "../lib/config";
import { fail, parseJson } from "../lib/http";
import { sendPush } from "../lib/push";
import { sha256Hex } from "../lib/tokens";
import { requireAuth, requireOnboarded } from "../middleware";
import type { AppEnv } from "../types";

interface CandidateRow {
  user_id: string;
  topic_id: string;
  topic_title: string;
  display_name: string;
  bio: string;
  role: string;
  avatar_key: string | null;
  fields: string;
  looking_for: string;
  verified_institution: number;
  campus_id: string | null;
  campus_name: string | null;
}

const MAX_CANDIDATE_ROWS = 2000;

async function viewerLookingFor(db: Db, userId: string): Promise<LookingFor[]> {
  const [profile] = await db.select({ lookingFor: schema.profiles.lookingFor }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  return profile?.lookingFor ?? [];
}

const people = new Hono<AppEnv>();
people.use("*", requireAuth, requireOnboarded);

people.get("/", async (c) => {
  const user = c.get("user");
  const db = getDb(c.env);
  const { results } = await c.env.DB.prepare(
    `SELECT theirs.user_id, mine.topic_id, t.title AS topic_title, p.display_name, p.bio, p.role, p.avatar_key,
            p.fields, p.looking_for, u.verified_institution, u.campus_id, campus.name AS campus_name
     FROM topic_swipes mine
     JOIN topic_swipes theirs ON theirs.topic_id = mine.topic_id AND theirs.direction = 'right' AND theirs.user_id != mine.user_id
     JOIN users u ON u.id = theirs.user_id AND u.status = 'active' AND u.city_id = ?1 AND u.onboarded_at IS NOT NULL
     JOIN profiles p ON p.user_id = u.id
     JOIN topics t ON t.id = mine.topic_id
     LEFT JOIN localities campus ON campus.id = u.campus_id
     WHERE mine.user_id = ?2 AND mine.direction = 'right'
       AND NOT EXISTS (SELECT 1 FROM people_swipes ps WHERE ps.from_user = ?2 AND ps.to_user = theirs.user_id)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ?2 AND b.blocked_id = theirs.user_id) OR (b.blocker_id = theirs.user_id AND b.blocked_id = ?2))
     LIMIT ?3`,
  )
    .bind(user.cityId, user.id, MAX_CANDIDATE_ROWS)
    .all<CandidateRow>();

  const byUser = new Map<string, { row: CandidateRow; topics: { id: string; title: string }[] }>();
  for (const row of results) {
    const entry = byUser.get(row.user_id) ?? { row, topics: [] };
    entry.topics.push({ id: row.topic_id, title: row.topic_title });
    byUser.set(row.user_id, entry);
  }

  const viewerChips = await viewerLookingFor(db, user.id);
  const ranked = rankPeople(
    [...byUser.values()].map(({ row, topics }) => ({
      userId: row.user_id,
      sharedTopicIds: topics.map((topic) => topic.id),
      lookingFor: JSON.parse(row.looking_for) as LookingFor[],
      campusId: row.campus_id,
      row,
      topics,
    })),
    { lookingFor: viewerChips, campusId: user.campusId },
  );

  const cards: PersonCard[] = ranked.map(({ userId, row, topics, lookingFor }) => ({
    id: userId,
    displayName: row.display_name,
    bio: row.bio,
    role: row.role as Role,
    avatarUrl: avatarUrl(c.env, row.avatar_key),
    verifiedInstitution: row.verified_institution === 1,
    campusName: row.campus_name,
    fields: JSON.parse(row.fields) as Field[],
    lookingFor: visibleLookingFor(lookingFor, viewerChips),
    sharedTopics: topics,
  }));
  return c.json(cards);
});

async function sharedTopicId(db: Db, a: string, b: string): Promise<string | null> {
  const rows = await db.all<{ topic_id: string }>(sql`
    SELECT mine.topic_id FROM topic_swipes mine
    JOIN topic_swipes theirs ON theirs.topic_id = mine.topic_id AND theirs.user_id = ${b} AND theirs.direction = 'right'
    WHERE mine.user_id = ${a} AND mine.direction = 'right'
    ORDER BY max(mine.created_at, theirs.created_at) DESC
    LIMIT 1`);
  return rows[0]?.topic_id ?? null;
}

/**
 * The IDs come from the pair, so if both people swipe at the same moment both
 * batches target the same rows and only one of them inserts the match.
 */
async function createMatch(env: Env, db: Db, a: string, b: string, topicId: string | null): Promise<string> {
  const [userA, userB] = orderedPair(a, b);
  const pairHash = await sha256Hex(`${userA}:${userB}`);
  const conversationId = `dm_${pairHash.slice(0, 32)}`;
  const now = Date.now();

  const [inserted] = await db.batch([
    db
      .insert(schema.matches)
      .values({
        id: `match_${pairHash.slice(0, 32)}`,
        userA,
        userB,
        topicId,
        conversationId,
        expiresAt: matchExpiresAt(now, jobOffsets(env)),
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: schema.matches.id }),
    db.insert(schema.conversations).values({ id: conversationId, kind: "direct", topicId, createdAt: now }).onConflictDoNothing(),
    db
      .insert(schema.conversationMembers)
      .values([userA, userB].map((userId) => ({ conversationId, userId, joinedAt: now })))
      .onConflictDoNothing(),
  ]);
  if (inserted.length === 0) return conversationId;

  const [topic] = topicId ? await db.select().from(schema.topics).where(eq(schema.topics.id, topicId)) : [];
  const title = topic?.title ?? "the same ideas";
  const opener = pickOpener(topic?.openers ?? []);
  await env.CHAT_ROOM.getByName(conversationId).postSystem(conversationId, matchOpenerMessage(title, opener));
  await sendPush(env, [userA, userB], {
    title: "It's a match",
    body: `You both picked ${topicPhrase(title)}`,
    data: { screen: "chat", id: conversationId },
  });
  return conversationId;
}

people.post("/:id/swipe", async (c) => {
  const user = c.get("user");
  const targetId = c.req.param("id");
  if (targetId === user.id) throw fail(400, "cannot_swipe_self");
  const { direction } = await parseJson(c, peopleSwipeSchema);
  const db = getDb(c.env);

  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, targetId));
  if (!target || target.status !== "active" || target.cityId !== user.cityId) throw fail(404, "person_not_found");
  if ((await blockedWith(db, user.id)).has(targetId)) throw fail(404, "person_not_found");

  const viaTopicId = await sharedTopicId(db, user.id, targetId);
  if (!viaTopicId) throw fail(409, "no_shared_topic");

  await db
    .insert(schema.peopleSwipes)
    .values({ fromUser: user.id, toUser: targetId, direction, viaTopicId, createdAt: Date.now() })
    .onConflictDoNothing();

  const swipes = schema.peopleSwipes;
  const [[mine], [theirs]] = await Promise.all([
    db.select().from(swipes).where(and(eq(swipes.fromUser, user.id), eq(swipes.toUser, targetId))),
    db.select().from(swipes).where(and(eq(swipes.fromUser, targetId), eq(swipes.toUser, user.id))),
  ]);
  if (!mine || !isMutualMatch(mine.direction, theirs?.direction)) {
    return c.json({ matched: false, conversationId: null } satisfies PeopleSwipeResult);
  }

  const conversationId = await createMatch(c.env, db, user.id, targetId, mine.viaTopicId);
  return c.json({ matched: true, conversationId } satisfies PeopleSwipeResult);
});

export default people;
