import { isAdult, locationSchema, onboardingSchema, profileSchema, pushTokenSchema, type Locality, type Me } from "@ideas-match/shared";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "../db";
import { avatarUrl } from "../lib/config";
import { fail, parseJson } from "../lib/http";
import { newId } from "../lib/tokens";
import { requireAuth } from "../middleware";
import type { AppEnv, UserRow } from "../types";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** Confirms the city exists and the campus belongs to it. */
async function requireLocation(db: ReturnType<typeof getDb>, cityId: string, campusId: string | null) {
  const [city] = await db.select().from(schema.localities).where(and(eq(schema.localities.id, cityId), eq(schema.localities.kind, "city")));
  if (!city) throw fail(400, "unknown_city");
  if (campusId) {
    const [campus] = await db
      .select()
      .from(schema.localities)
      .where(and(eq(schema.localities.id, campusId), eq(schema.localities.kind, "campus"), eq(schema.localities.parentId, city.id)));
    if (!campus) throw fail(400, "unknown_campus");
  }
  return city;
}

export async function loadMe(env: Env, user: UserRow): Promise<Me> {
  const [profile] = await getDb(env).select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  return {
    id: user.id,
    email: user.email,
    verifiedInstitution: user.verifiedInstitution,
    institutionDomain: user.institutionDomain,
    onboarded: user.onboardedAt !== null,
    cityId: user.cityId,
    campusId: user.campusId,
    profile: profile
      ? {
          displayName: profile.displayName,
          bio: profile.bio,
          role: profile.role,
          fields: profile.fields,
          lookingFor: profile.lookingFor,
          avatarUrl: avatarUrl(env, profile.avatarKey),
        }
      : null,
  };
}

function imageExtension(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  const text = String.fromCharCode(...bytes.slice(0, 12));
  if (text.startsWith("RIFF") && text.slice(8) === "WEBP") return "webp";
  return null;
}

const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

const me = new Hono<AppEnv>();
me.use("*", requireAuth);

me.get("/", async (c) => c.json(await loadMe(c.env, c.get("user"))));

me.get("/localities", async (c) => {
  const rows: Locality[] = await getDb(c.env).select().from(schema.localities).orderBy(desc(schema.localities.population));
  return c.json(rows);
});

me.put("/onboarding", async (c) => {
  const user = c.get("user");
  if (user.onboardedAt) throw fail(409, "already_onboarded");
  const input = await parseJson(c, onboardingSchema);
  // Nothing is stored for someone under the age limit.
  if (!isAdult(input.dob)) throw fail(403, "under_age");

  const db = getDb(c.env);
  const city = await requireLocation(db, input.cityId, input.campusId);

  const profile = { displayName: input.displayName, bio: input.bio, role: input.role, fields: input.fields, lookingFor: input.lookingFor };
  await db.batch([
    db.insert(schema.profiles).values({ userId: user.id, ...profile }).onConflictDoUpdate({ target: schema.profiles.userId, set: profile }),
    db.update(schema.users).set({ dob: input.dob, cityId: city.id, campusId: input.campusId, onboardedAt: Date.now() }).where(eq(schema.users.id, user.id)),
  ]);
  const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  return c.json(await loadMe(c.env, updated!));
});

me.put("/profile", async (c) => {
  const user = c.get("user");
  if (!user.onboardedAt) throw fail(403, "onboarding_required");
  const input = await parseJson(c, profileSchema);
  await getDb(c.env).update(schema.profiles).set(input).where(eq(schema.profiles.userId, user.id));
  return c.json(await loadMe(c.env, user));
});

/** People move, or may have picked somewhere close before their city was listed. */
me.put("/location", async (c) => {
  const user = c.get("user");
  if (!user.onboardedAt) throw fail(403, "onboarding_required");
  const input = await parseJson(c, locationSchema);
  const db = getDb(c.env);
  await requireLocation(db, input.cityId, input.campusId);
  const [updated] = await db.update(schema.users).set({ cityId: input.cityId, campusId: input.campusId }).where(eq(schema.users.id, user.id)).returning();
  return c.json(await loadMe(c.env, updated!));
});

/** The app resizes before uploading, since Workers cannot resize images without an extra product. */
me.put("/avatar", async (c) => {
  const user = c.get("user");
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_AVATAR_BYTES) throw fail(413, "too_large");
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_AVATAR_BYTES) throw fail(413, "too_large");
  const extension = imageExtension(new Uint8Array(body.slice(0, 12)));
  if (!extension) throw fail(415, "unsupported_image");

  const db = getDb(c.env);
  const [existing] = await db.select({ key: schema.profiles.avatarKey }).from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  if (!existing) throw fail(409, "create_profile_first");

  const key = `${newId()}.${extension}`;
  await c.env.AVATARS.put(key, body, { httpMetadata: { contentType: CONTENT_TYPES[extension]!, cacheControl: "public, max-age=31536000, immutable" } });
  await db.update(schema.profiles).set({ avatarKey: key }).where(eq(schema.profiles.userId, user.id));
  if (existing.key) await c.env.AVATARS.delete(existing.key);
  return c.json({ avatarUrl: avatarUrl(c.env, key) });
});

me.post("/push-token", async (c) => {
  const input = await parseJson(c, pushTokenSchema);
  const row = { token: input.token, platform: input.platform, userId: c.get("user").id };
  await getDb(c.env).insert(schema.pushTokens).values(row).onConflictDoUpdate({ target: schema.pushTokens.token, set: row });
  return c.json({ ok: true });
});

me.delete("/push-token", async (c) => {
  const input = await parseJson(c, pushTokenSchema);
  await getDb(c.env)
    .delete(schema.pushTokens)
    .where(and(eq(schema.pushTokens.token, input.token), eq(schema.pushTokens.userId, c.get("user").id)));
  return c.json({ ok: true });
});

/** App Store and Play policy both require in-app account deletion. Reports are kept for moderation history. */
me.delete("/", async (c) => {
  const user = c.get("user");
  const db = getDb(c.env);
  const id = user.id;

  const memberships = await db
    .select({ id: schema.conversationMembers.conversationId })
    .from(schema.conversationMembers)
    .where(eq(schema.conversationMembers.userId, id));
  await Promise.all(memberships.map((row) => c.env.CHAT_ROOM.getByName(row.id).eraseUser(id)));

  const [profile] = await db.select({ key: schema.profiles.avatarKey }).from(schema.profiles).where(eq(schema.profiles.userId, id));
  if (profile?.key) await c.env.AVATARS.delete(profile.key);

  const conversationIds = memberships.map((row) => row.id);
  await db.batch([
    db.update(schema.matches).set({ state: "closed" }).where(or(eq(schema.matches.userA, id), eq(schema.matches.userB, id))),
    db.delete(schema.conversationMembers).where(eq(schema.conversationMembers.userId, id)),
    db.delete(schema.topicSwipes).where(eq(schema.topicSwipes.userId, id)),
    db.delete(schema.peopleSwipes).where(or(eq(schema.peopleSwipes.fromUser, id), eq(schema.peopleSwipes.toUser, id))),
    db.delete(schema.blocks).where(or(eq(schema.blocks.blockerId, id), eq(schema.blocks.blockedId, id))),
    db.delete(schema.meetupResponses).where(eq(schema.meetupResponses.userId, id)),
    db.delete(schema.pushTokens).where(eq(schema.pushTokens.userId, id)),
    db.delete(schema.sessions).where(eq(schema.sessions.userId, id)),
    db.delete(schema.profiles).where(eq(schema.profiles.userId, id)),
    db
      .update(schema.users)
      .set({ status: "deleted", email: `deleted-${id}@deleted.invalid`, dob: null, institutionDomain: null, verifiedInstitution: false, cityId: null, campusId: null })
      .where(eq(schema.users.id, id)),
    ...(conversationIds.length
      ? [db.update(schema.conversations).set({ lastMessagePreview: null, lastMessageSenderId: null }).where(and(inArray(schema.conversations.id, conversationIds), eq(schema.conversations.lastMessageSenderId, id)))]
      : []),
  ]);
  return c.json({ ok: true });
});

export default me;
