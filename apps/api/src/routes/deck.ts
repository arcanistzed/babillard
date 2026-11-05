import { rankTopics, topicSwipeSchema, topicSubmissionSchema, type TopicCard, type TopicSwipeResult } from "@ideas-match/shared";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "../db";
import { fail, parseJson } from "../lib/http";
import { newId } from "../lib/tokens";
import { requireAuth, requireOnboarded } from "../middleware";
import type { AppEnv } from "../types";

const MAX_SUBMISSIONS_PER_DAY = 5;
const DAY = 24 * 60 * 60 * 1000;

export function cohortName(topicId: string, cityId: string): string {
  return `${topicId}:${cityId}`;
}

/** Adds someone to a topic's cohort. Returns the group conversation they landed in, if any. */
export async function joinCohort(
  env: Env,
  args: { userId: string; cityId: string; topic: { id: string; kind: "interest" | "question"; title: string }; stance: "for" | "against" | "unsure" | null },
): Promise<string | null> {
  const [city] = await getDb(env).select({ name: schema.localities.name }).from(schema.localities).where(eq(schema.localities.id, args.cityId));
  return env.COHORT.getByName(cohortName(args.topic.id, args.cityId)).join({
    userId: args.userId,
    stance: args.stance,
    topicId: args.topic.id,
    topicKind: args.topic.kind,
    topicTitle: args.topic.title,
    cityId: args.cityId,
    cityName: city?.name ?? "your city",
  });
}

const deck = new Hono<AppEnv>();
deck.use("*", requireAuth, requireOnboarded);

deck.get("/topics", async (c) => {
  const user = c.get("user");
  const db = getDb(c.env);
  const swipes = schema.topicSwipes;

  const [candidates, cohorts, profile] = await Promise.all([
    db
      .select({ topic: schema.topics })
      .from(schema.topics)
      .leftJoin(swipes, and(eq(swipes.topicId, schema.topics.id), eq(swipes.userId, user.id)))
      .where(
        and(
          isNull(swipes.userId),
          or(inArray(schema.topics.status, ["seeded", "approved"]), and(eq(schema.topics.status, "pending"), eq(schema.topics.createdBy, user.id))),
        ),
      ),
    db
      .select({ topicId: swipes.topicId, count: sql<number>`count(*)` })
      .from(swipes)
      .innerJoin(schema.users, eq(schema.users.id, swipes.userId))
      .where(and(eq(swipes.direction, "right"), eq(schema.users.cityId, user.cityId!), eq(schema.users.status, "active")))
      .groupBy(swipes.topicId),
    db.select({ fields: schema.profiles.fields }).from(schema.profiles).where(eq(schema.profiles.userId, user.id)),
  ]);

  const nearby = new Map(cohorts.map((row) => [row.topicId, row.count]));
  const ranked = rankTopics(
    candidates.map(({ topic }) => ({ ...topic, cohortSize: nearby.get(topic.id) ?? 0 })),
    { userFields: profile[0]?.fields ?? [] },
  );
  const cards: TopicCard[] = ranked.map((topic) => ({
    id: topic.id,
    kind: topic.kind,
    title: topic.title,
    blurb: topic.blurb,
    fieldTags: topic.fieldTags,
    nearbyCount: topic.cohortSize,
    pending: topic.status === "pending",
  }));
  return c.json(cards);
});

deck.post("/topics/:id/swipe", async (c) => {
  const user = c.get("user");
  const input = await parseJson(c, topicSwipeSchema);
  const db = getDb(c.env);
  const topicId = c.req.param("id");

  const [topic] = await db.select().from(schema.topics).where(eq(schema.topics.id, topicId));
  const visible = topic && (topic.status === "seeded" || topic.status === "approved" || (topic.status === "pending" && topic.createdBy === user.id));
  if (!visible) throw fail(404, "topic_not_found");

  const stance = topic.kind === "question" && input.direction === "right" ? input.stance : null;
  await db
    .insert(schema.topicSwipes)
    .values({ userId: user.id, topicId, direction: input.direction, stance, createdAt: Date.now() })
    .onConflictDoNothing();
  const [swipe] = await db
    .select()
    .from(schema.topicSwipes)
    .where(and(eq(schema.topicSwipes.userId, user.id), eq(schema.topicSwipes.topicId, topicId)));

  // A retried swipe calls join again on purpose. The cohort ignores repeats, so a failed first attempt can recover.
  let groupConversationId: string | null = null;
  if (swipe?.direction === "right" && topic.status !== "pending") {
    try {
      groupConversationId = await joinCohort(c.env, { userId: user.id, cityId: user.cityId!, topic, stance: swipe.stance });
    } catch (error) {
      console.error(JSON.stringify({ event: "cohort_join_failed", topicId, error: String(error) }));
    }
  }
  return c.json({ groupConversationId } satisfies TopicSwipeResult);
});

/** Submitted topics show in the submitter's own deck right away and in everyone else's after review. */
deck.post("/topics", async (c) => {
  const user = c.get("user");
  const input = await parseJson(c, topicSubmissionSchema);
  const db = getDb(c.env);
  const now = Date.now();

  const [recent] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.topics)
    .where(and(eq(schema.topics.createdBy, user.id), gt(schema.topics.createdAt, now - DAY)));
  if ((recent?.count ?? 0) >= MAX_SUBMISSIONS_PER_DAY) throw fail(429, "too_many_submissions");

  const id = newId();
  await db.insert(schema.topics).values({ id, ...input, openers: [], status: "pending", createdBy: user.id, createdAt: now });
  return c.json({ id, status: "pending" }, 201);
});

export default deck;
