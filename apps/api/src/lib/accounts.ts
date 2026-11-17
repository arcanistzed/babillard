import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { blockedEmailTombstone, deletedEmail, releaseUnblockedTombstones } from "./blocks";
import { cohortsHolding, forgetInCohorts } from "./cohorts";
import { settleUpcomingMeetups } from "./meetupState";

/**
 * Removes everything personal about someone. An empty row stays so that other people's conversations keep working.
 * Blocks other people made on this person stay, and so does a keyed hash of the email while any remain,
 * so that signing up again with the same address can't get around them.
 */
export async function deleteAccount(env: Env, id: string): Promise<void> {
  const db = getDb(env);
  const [[account], theirBlocks] = await Promise.all([
    db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, id)),
    db.select({ id: schema.blocks.blockedId }).from(schema.blocks).where(eq(schema.blocks.blockerId, id)),
  ]);
  const hashed = !account ? deletedEmail(id) : account.email.endsWith("@deleted.invalid") ? account.email : await blockedEmailTombstone(env.AUTH_SECRET, account.email);
  // Decided inside the batch, so a block made or removed while this runs is counted.
  const keptEmail = sql`CASE WHEN EXISTS (SELECT 1 FROM blocks WHERE blocked_id = ${id}) THEN ${hashed} ELSE ${deletedEmail(id)} END`;
  const memberships = await db
    .select({ id: schema.conversationMembers.conversationId })
    .from(schema.conversationMembers)
    .where(eq(schema.conversationMembers.userId, id));

  const [profile] = await db.select({ key: schema.profiles.avatarKey, name: schema.profiles.displayName }).from(schema.profiles).where(eq(schema.profiles.userId, id));
  await Promise.all(memberships.map((row) => env.CHAT_ROOM.getByName(row.id).eraseUser(id, profile?.name ?? null)));
  if (profile?.key) await env.AVATARS.delete(profile.key);

  // Read before the batch below deletes the swipes and memberships that say which cohorts hold this person.
  const cohorts = await cohortsHolding(env, id);

  const conversationIds = memberships.map((row) => row.id);
  const namePrefix = profile ? `${profile.name} ` : null;
  const previewNamesDeletedUser = or(
    eq(schema.conversations.lastMessageSenderId, id),
    namePrefix ? and(isNull(schema.conversations.lastMessageSenderId), sql`substr(${schema.conversations.lastMessagePreview}, 1, ${[...namePrefix].length}) = ${namePrefix}`) : undefined,
  );
  await db.batch([
    db.update(schema.matches).set({ state: "closed" }).where(or(eq(schema.matches.userA, id), eq(schema.matches.userB, id))),
    db.delete(schema.conversationMembers).where(eq(schema.conversationMembers.userId, id)),
    db.delete(schema.topicSwipes).where(eq(schema.topicSwipes.userId, id)),
    db.delete(schema.peopleSwipes).where(or(eq(schema.peopleSwipes.fromUser, id), eq(schema.peopleSwipes.toUser, id))),
    db.delete(schema.blocks).where(eq(schema.blocks.blockerId, id)),
    db.delete(schema.meetupResponses).where(eq(schema.meetupResponses.userId, id)),
    db.delete(schema.meetupOutcomes).where(eq(schema.meetupOutcomes.userId, id)),
    db.delete(schema.meetupInvites).where(eq(schema.meetupInvites.userId, id)),
    db.delete(schema.pushTokens).where(eq(schema.pushTokens.userId, id)),
    db.delete(schema.deviceKeys).where(eq(schema.deviceKeys.userId, id)),
    db.delete(schema.sessions).where(eq(schema.sessions.userId, id)),
    db.delete(schema.profiles).where(eq(schema.profiles.userId, id)),
    db
      .update(schema.users)
      .set({ status: "deleted", email: keptEmail, dob: null, institutionDomain: null, verifiedInstitution: false, cityId: null, campusId: null })
      .where(eq(schema.users.id, id)),
    ...(conversationIds.length
      ? [db.update(schema.conversations).set({ lastMessagePreview: null, lastMessagePreviewFr: null, lastMessageEnvelope: null, lastMessageSenderId: null }).where(and(inArray(schema.conversations.id, conversationIds), previewNamesDeletedUser))]
      : []),
  ]);
  // Accounts this person blocked may have been deleted too, and may now be blocked by nobody.
  await releaseUnblockedTombstones(db, theirBlocks.map((row) => row.id));
  // Their yeses are gone, so meetups that needed them go back to proposed now rather than at the next sweep.
  // One-on-one chats are closed above and are left alone.
  for (const conversationId of conversationIds) await settleUpcomingMeetups(env, db, conversationId);
  await forgetInCohorts(env, id, cohorts);
}
