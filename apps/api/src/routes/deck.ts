import { DECK_PAGE_SIZE, FIELD_GROUPS, NEWCOMER_SWIPES, leanSummary, MEETUPS_HELD_MIN_SHOWN, outcomeSummary, rankTopics, type OutcomeCounts, topicSwipeSchema, topicSubmissionSchema, type TopicCard, type TopicSwipeResult } from "@babillard/shared";
import { localizeTopic, requestLanguage } from "../lib/language";
import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
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
  args: { userId: string; cityId: string; topic: { id: string; kind: "interest" | "question"; title: string; fr?: { title: string } | null }; stance: "for" | "against" | "unsure" | null },
): Promise<string | null> {
  const [city] = await getDb(env).select({ name: schema.localities.name }).from(schema.localities).where(eq(schema.localities.id, args.cityId));
  return env.COHORT.getByName(cohortName(args.topic.id, args.cityId)).join({
    userId: args.userId,
    stance: args.stance,
    topicId: args.topic.id,
    topicKind: args.topic.kind,
    topicTitle: args.topic.title,
    topicTitleFr: args.topic.fr?.title ?? args.topic.title,
    cityId: args.cityId,
    cityName: city?.name ?? "your city",
  });
}

/** The place values a topic can carry and still reach someone in this city: the city, its province or state, and its country. */
export function placesFor(cityId: string, home: { region: string; countryCode: string } | undefined): string[] {
  return home ? [cityId, `${home.countryCode}:${home.region}`, home.countryCode] : [cityId];
}

const deck = new Hono<AppEnv>();
deck.use("*", requireAuth, requireOnboarded);

deck.get("/topics", async (c) => {
  const user = c.get("user");
  const db = getDb(c.env);
  const swipes = schema.topicSwipes;
  const [home] = await db.select({ region: schema.localities.region, countryCode: schema.localities.countryCode }).from(schema.localities).where(eq(schema.localities.id, user.cityId!));
  const places = placesFor(user.cityId!, home);

  const [candidates, cohorts, profile, swiped] = await Promise.all([
    db
      .select({ topic: schema.topics })
      .from(schema.topics)
      .leftJoin(swipes, and(eq(swipes.topicId, schema.topics.id), eq(swipes.userId, user.id)))
      .where(
        and(
          isNull(swipes.userId),
          or(isNull(schema.topics.place), inArray(schema.topics.place, places)),
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
    db.select({ count: sql<number>`count(*)` }).from(swipes).where(eq(swipes.userId, user.id)),
  ]);

  const nearby = new Map(cohorts.map((row) => [row.topicId, row.count]));
  const group = FIELD_GROUPS.find((entry) => entry.id === c.req.query("group"));
  const inGroup = (topic: { fieldTags: string[] }) => !group || topic.fieldTags.some((tag) => (group.fields as readonly string[]).includes(tag));
  const withCohorts = candidates.filter(({ topic }) => inGroup(topic)).map(({ topic }) => ({ ...topic, cohortSize: nearby.get(topic.id) ?? 0 }));
  // Someone's own suggestion is promised to appear right away, so it never competes on ranking.
  const ownPending = withCohorts.filter((topic) => topic.status === "pending");
  const ranked = [
    ...ownPending,
    ...rankTopics(
      withCohorts.filter((topic) => topic.status !== "pending"),
      { userFields: profile[0]?.fields ?? [], limit: Math.max(DECK_PAGE_SIZE - ownPending.length, 0), newcomer: (swiped[0]?.count ?? 0) < NEWCOMER_SWIPES },
    ),
  ];
  const ids = ranked.map((topic) => topic.id);
  const [stanceRows, heldRows, outcomeRows] = ids.length
    ? await Promise.all([
        db
          .select({ topicId: swipes.topicId, stance: swipes.stance, count: sql<number>`count(*)` })
          .from(swipes)
          .innerJoin(schema.users, eq(schema.users.id, swipes.userId))
          .where(and(inArray(swipes.topicId, ids), eq(swipes.direction, "right"), isNotNull(swipes.stance), eq(schema.users.cityId, user.cityId!), eq(schema.users.status, "active")))
          .groupBy(swipes.topicId, swipes.stance),
        db
          .select({ topicId: schema.conversations.topicId, count: sql<number>`count(DISTINCT ${schema.meetups.id})` })
          .from(schema.meetups)
          .innerJoin(schema.conversations, eq(schema.conversations.id, schema.meetups.conversationId))
          .innerJoin(schema.meetupResponses, eq(schema.meetupResponses.meetupId, schema.meetups.id))
          .where(and(inArray(schema.conversations.topicId, ids), eq(schema.meetupResponses.didMeet, true)))
          .groupBy(schema.conversations.topicId),
        db
          .select({
            topicId: schema.conversations.topicId,
            mindChanged: schema.meetupOutcomes.mindChanged,
            endedUp: schema.meetupOutcomes.endedUp,
            meetAgain: schema.meetupOutcomes.meetAgain,
            count: sql<number>`count(*)`,
          })
          .from(schema.meetupOutcomes)
          .innerJoin(schema.meetups, eq(schema.meetups.id, schema.meetupOutcomes.meetupId))
          .innerJoin(schema.conversations, eq(schema.conversations.id, schema.meetups.conversationId))
          .innerJoin(
            schema.meetupResponses,
            and(eq(schema.meetupResponses.meetupId, schema.meetupOutcomes.meetupId), eq(schema.meetupResponses.userId, schema.meetupOutcomes.userId)),
          )
          // Someone who later says the meetup didn't happen no longer counts.
          .where(and(inArray(schema.conversations.topicId, ids), eq(schema.meetupResponses.didMeet, true)))
          .groupBy(schema.conversations.topicId, schema.meetupOutcomes.mindChanged, schema.meetupOutcomes.endedUp, schema.meetupOutcomes.meetAgain),
      ])
    : [[], [], []];
  const stanceCounts = (topicId: string) => Object.fromEntries(stanceRows.filter((row) => row.topicId === topicId).map((row) => [row.stance, row.count]));
  const held = new Map(heldRows.map((row) => [row.topicId, row.count]));
  const outcomeCounts = new Map<string, OutcomeCounts>();
  for (const row of outcomeRows) {
    if (!row.topicId) continue;
    const counts = outcomeCounts.get(row.topicId) ?? { mindChanged: {}, endedUp: {}, meetAgain: {} };
    counts.mindChanged[row.mindChanged] = (counts.mindChanged[row.mindChanged] ?? 0) + row.count;
    counts.endedUp[row.endedUp] = (counts.endedUp[row.endedUp] ?? 0) + row.count;
    counts.meetAgain[row.meetAgain] = (counts.meetAgain[row.meetAgain] ?? 0) + row.count;
    outcomeCounts.set(row.topicId, counts);
  }

  const language = requestLanguage(c);
  const cards: TopicCard[] = ranked.map((topic) => ({
    id: topic.id,
    kind: topic.kind,
    title: localizeTopic(topic, language).title,
    blurb: localizeTopic(topic, language).blurb,
    fieldTags: topic.fieldTags,
    nearbyCount: topic.cohortSize,
    pending: topic.status === "pending",
    lean: topic.kind === "question" ? leanSummary(stanceCounts(topic.id)) : null,
    meetupsHeld: (held.get(topic.id) ?? 0) >= MEETUPS_HELD_MIN_SHOWN ? held.get(topic.id)! : null,
    outcomes: outcomeCounts.has(topic.id) ? outcomeSummary(outcomeCounts.get(topic.id)!) : null,
  }));
  return c.json(cards);
});

deck.post("/topics/:id/swipe", async (c) => {
  const user = c.get("user");
  const input = await parseJson(c, topicSwipeSchema);
  const db = getDb(c.env);
  const topicId = c.req.param("id");

  const [[topic], [home]] = await Promise.all([
    db.select().from(schema.topics).where(eq(schema.topics.id, topicId)),
    db.select({ region: schema.localities.region, countryCode: schema.localities.countryCode }).from(schema.localities).where(eq(schema.localities.id, user.cityId!)),
  ]);
  const inPlace = !topic?.place || placesFor(user.cityId!, home).includes(topic.place);
  const visible = topic && inPlace && (topic.status === "seeded" || topic.status === "approved" || (topic.status === "pending" && topic.createdBy === user.id));
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
  // A suggestion only reaches people in the suggester's city, and approval keeps it there.
  await db.insert(schema.topics).values({ id, ...input, openers: [], status: "pending", place: user.cityId, createdBy: user.id, createdAt: now });
  return c.json({ id, status: "pending" }, 201);
});

export default deck;
