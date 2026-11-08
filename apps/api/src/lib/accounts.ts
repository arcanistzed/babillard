import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "../db";

/** Removes everything personal about someone. An empty row stays so that other people's conversations keep working. */
export async function deleteAccount(env: Env, id: string): Promise<void> {
  const db = getDb(env);
  const memberships = await db
    .select({ id: schema.conversationMembers.conversationId })
    .from(schema.conversationMembers)
    .where(eq(schema.conversationMembers.userId, id));

  const [profile] = await db.select({ key: schema.profiles.avatarKey, name: schema.profiles.displayName }).from(schema.profiles).where(eq(schema.profiles.userId, id));
  await Promise.all(memberships.map((row) => env.CHAT_ROOM.getByName(row.id).eraseUser(id, profile?.name ?? null)));
  if (profile?.key) await env.AVATARS.delete(profile.key);

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
    db.delete(schema.blocks).where(or(eq(schema.blocks.blockerId, id), eq(schema.blocks.blockedId, id))),
    db.delete(schema.meetupResponses).where(eq(schema.meetupResponses.userId, id)),
    db.delete(schema.meetupOutcomes).where(eq(schema.meetupOutcomes.userId, id)),
    db.delete(schema.pushTokens).where(eq(schema.pushTokens.userId, id)),
    db.delete(schema.deviceKeys).where(eq(schema.deviceKeys.userId, id)),
    db.delete(schema.sessions).where(eq(schema.sessions.userId, id)),
    db.delete(schema.profiles).where(eq(schema.profiles.userId, id)),
    db
      .update(schema.users)
      .set({ status: "deleted", email: `deleted-${id}@deleted.invalid`, dob: null, institutionDomain: null, verifiedInstitution: false, cityId: null, campusId: null })
      .where(eq(schema.users.id, id)),
    ...(conversationIds.length
      ? [db.update(schema.conversations).set({ lastMessagePreview: null, lastMessagePreviewFr: null, lastMessageEnvelope: null, lastMessageSenderId: null }).where(and(inArray(schema.conversations.id, conversationIds), previewNamesDeletedUser))]
      : []),
  ]);
}
