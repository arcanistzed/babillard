import type { Lean } from "@babillard/shared";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "../db";

export function cohortName(topicId: string, cityId: string): string {
  return `${topicId}:${cityId}`;
}

// The same cap as carrying topics to a new city. Any cohort past it is cleaned the next time someone joins it.
const MAX_COHORTS_FORGOTTEN = 100;

/**
 * Takes a person out of every cohort that can be found for them: the topics they joined in their current city,
 * and the topics and cities of their groups. Call it before their swipes and memberships are deleted.
 * A cohort that fails, or one in a city they moved away from, removes them the next time anyone joins it.
 */
export async function forgetInCohorts(env: Env, userId: string): Promise<void> {
  try {
    await forgetFoundCohorts(env, userId);
  } catch (error) {
    // Deleting the account must still go ahead. The cohorts' own check catches whatever this missed.
    console.error(JSON.stringify({ event: "cohorts_forget_failed", error: String(error) }));
  }
}

async function forgetFoundCohorts(env: Env, userId: string): Promise<void> {
  const db = getDb(env);
  const [[account], joined, groups] = await Promise.all([
    db.select({ cityId: schema.users.cityId }).from(schema.users).where(eq(schema.users.id, userId)),
    db
      .select({ topicId: schema.topicSwipes.topicId })
      .from(schema.topicSwipes)
      .where(and(eq(schema.topicSwipes.userId, userId), eq(schema.topicSwipes.direction, "right")))
      .orderBy(desc(schema.topicSwipes.createdAt))
      .limit(MAX_COHORTS_FORGOTTEN),
    db
      .select({ topicId: schema.conversations.topicId, localityId: schema.conversations.localityId })
      .from(schema.conversationMembers)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.conversationMembers.conversationId))
      .where(and(eq(schema.conversationMembers.userId, userId), eq(schema.conversations.kind, "group"), isNotNull(schema.conversations.topicId), isNotNull(schema.conversations.localityId)))
      .limit(MAX_COHORTS_FORGOTTEN),
  ]);
  const names = new Set<string>();
  for (const group of groups) names.add(cohortName(group.topicId!, group.localityId!));
  if (account?.cityId) for (const row of joined) names.add(cohortName(row.topicId, account.cityId));

  const results = await Promise.allSettled([...names].slice(0, MAX_COHORTS_FORGOTTEN).map((name) => env.COHORT.getByName(name).forget(userId)));
  const removed = results.reduce((total, result) => total + (result.status === "fulfilled" ? result.value : 0), 0);
  const failed = results.filter((result) => result.status === "rejected").length;
  console.log(JSON.stringify({ event: "cohorts_forgot", cohorts: names.size, removed, failed }));
}

/** Puts someone who left a group back on its topic's waiting list, kept out of the group they left. */
export async function requeueAfterLeaving(env: Env, conversation: { id: string; topicId: string | null; localityId: string | null }, userId: string): Promise<void> {
  if (!conversation.topicId || !conversation.localityId) return;
  try {
    // Named from the group, not the person, who may have moved city since.
    await env.COHORT.getByName(cohortName(conversation.topicId, conversation.localityId)).leaveGroup(userId, conversation.id);
  } catch (error) {
    // The cohort's daily check finds the missing membership and does the same.
    console.error(JSON.stringify({ event: "cohort_requeue_failed", conversationId: conversation.id, error: String(error) }));
  }
}

/** A question group's stance totals, as saved when it formed. */
export async function savedStanceSpread(env: Env, conversation: { id: string; kind: "direct" | "group"; localityId: string | null }, topic: { id: string; kind: "interest" | "question" } | null): Promise<Lean | null> {
  if (conversation.kind !== "group" || topic?.kind !== "question" || !conversation.localityId) return null;
  try {
    return await env.COHORT.getByName(cohortName(topic.id, conversation.localityId)).stanceSpread(conversation.id);
  } catch (error) {
    console.error(JSON.stringify({ event: "stance_spread_failed", conversationId: conversation.id, error: String(error) }));
    return null;
  }
}
