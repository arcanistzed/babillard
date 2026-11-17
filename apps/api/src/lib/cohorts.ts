import type { Lean } from "@babillard/shared";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "../db";

export function cohortName(topicId: string, cityId: string): string {
  return `${topicId}:${cityId}`;
}

// Each cohort is one call to a Durable Object, and a request on the Free plan gets 50 subrequests in all.
// Any cohort past this cap removes the person on its own daily check.
const MAX_COHORTS_FORGOTTEN = 25;

/**
 * The cohorts that hold a person: the topics they joined in their current city, and the topics and cities of
 * their groups. Read it before their swipes and memberships are deleted, then pass it to forgetInCohorts.
 */
export async function cohortsHolding(env: Env, userId: string): Promise<string[]> {
  try {
    return await findCohorts(env, userId);
  } catch (error) {
    // Deleting the account must still go ahead. The cohorts' own check catches whatever this missed.
    console.error(JSON.stringify({ event: "cohorts_lookup_failed", error: String(error) }));
    return [];
  }
}

async function findCohorts(env: Env, userId: string): Promise<string[]> {
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
  return [...names].slice(0, MAX_COHORTS_FORGOTTEN);
}

/** Takes a person out of the cohorts cohortsHolding found. Call it after the account is deleted, so a failure here never stops that. */
export async function forgetInCohorts(env: Env, userId: string, names: string[]): Promise<void> {
  const results = await Promise.allSettled(names.map((name) => env.COHORT.getByName(name).forget(userId)));
  const removed = results.reduce((total, result) => total + (result.status === "fulfilled" ? result.value : 0), 0);
  const failed = results.filter((result) => result.status === "rejected").length;
  console.log(JSON.stringify({ event: "cohorts_forgot", cohorts: names.length, removed, failed }));
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
