import { deviceKeySchema, isAdult, LEGAL_VERSION, locationSchema, onboardingSchema, profileSaveSchema, pushTokenSchema, type Locality, type Me } from "@ideas-match/shared";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "../db";
import { deleteAccount } from "../lib/accounts";
import { avatarUrl } from "../lib/config";
import { fail, parseJson } from "../lib/http";
import { newId } from "../lib/tokens";
import { requireAuth } from "../middleware";
import { joinCohort } from "./deck";
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
    termsAccepted: user.termsVersion === LEGAL_VERSION,
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

const MAX_TOPICS_CARRIED_TO_NEW_CITY = 100;

/** Someone's picks follow them, so they count toward groups in the new city. */
async function rejoinCohorts(env: Env, userId: string, cityId: string): Promise<void> {
  const db = getDb(env);
  const picks = await db
    .select({ topic: schema.topics, stance: schema.topicSwipes.stance })
    .from(schema.topicSwipes)
    .innerJoin(schema.topics, eq(schema.topics.id, schema.topicSwipes.topicId))
    .where(and(eq(schema.topicSwipes.userId, userId), eq(schema.topicSwipes.direction, "right"), inArray(schema.topics.status, ["seeded", "approved"])))
    .orderBy(desc(schema.topicSwipes.createdAt))
    .limit(MAX_TOPICS_CARRIED_TO_NEW_CITY);
  for (const { topic, stance } of picks) {
    try {
      await joinCohort(env, { userId, cityId, topic, stance });
    } catch (error) {
      console.error(JSON.stringify({ event: "cohort_rejoin_failed", topicId: topic.id, error: String(error) }));
    }
  }
}

const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

const me = new Hono<AppEnv>();
me.use("*", requireAuth);

me.get("/", async (c) => c.json(await loadMe(c.env, c.get("user"))));

const MAX_DEVICES_PER_PERSON = 5;

/** Called by each phone with its public key. A new key means new phones can read new messages, not old ones. */
me.post("/device-key", async (c) => {
  const user = c.get("user");
  const { publicKey } = await parseJson(c, deviceKeySchema);
  const db = getDb(c.env);
  const [existing] = await db.select().from(schema.deviceKeys).where(eq(schema.deviceKeys.publicKey, publicKey));
  if (existing && existing.userId !== user.id) throw fail(409, "key_in_use");
  const now = Date.now();
  await db
    .insert(schema.deviceKeys)
    .values({ publicKey, userId: user.id, createdAt: now })
    .onConflictDoUpdate({ target: schema.deviceKeys.publicKey, set: { retiredAt: null, createdAt: now } });
  const active = await db
    .select({ publicKey: schema.deviceKeys.publicKey })
    .from(schema.deviceKeys)
    .where(and(eq(schema.deviceKeys.userId, user.id), isNull(schema.deviceKeys.retiredAt)))
    .orderBy(desc(schema.deviceKeys.createdAt));
  const surplus = active.slice(MAX_DEVICES_PER_PERSON).map((row) => row.publicKey);
  if (surplus.length) await db.update(schema.deviceKeys).set({ retiredAt: now }).where(inArray(schema.deviceKeys.publicKey, surplus));
  return c.json({ ok: true });
});

me.get("/localities", async (c) => {
  const rows: Locality[] = await getDb(c.env).select().from(schema.localities).orderBy(desc(schema.localities.population));
  return c.json(rows);
});

me.post("/accept-terms", async (c) => {
  const user = c.get("user");
  const accepted = { termsVersion: LEGAL_VERSION, termsAcceptedAt: Date.now() };
  await getDb(c.env).update(schema.users).set(accepted).where(eq(schema.users.id, user.id));
  return c.json(await loadMe(c.env, { ...user, ...accepted }));
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
    db.update(schema.users).set({ dob: input.dob, cityId: city.id, campusId: input.campusId, onboardedAt: Date.now(), termsVersion: LEGAL_VERSION, termsAcceptedAt: Date.now() }).where(eq(schema.users.id, user.id)),
  ]);
  const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  return c.json(await loadMe(c.env, updated!));
});

/** Saves the edit-profile form in one transaction, so a failure can't leave it half saved. */
me.put("/profile", async (c) => {
  const user = c.get("user");
  if (!user.onboardedAt) throw fail(403, "onboarding_required");
  const { cityId, campusId, ...profile } = await parseJson(c, profileSaveSchema);
  const db = getDb(c.env);
  const location = cityId ? { cityId, campusId: campusId ?? null } : null;
  if (location) await requireLocation(db, location.cityId, location.campusId);
  await db.batch([
    db.update(schema.profiles).set(profile).where(eq(schema.profiles.userId, user.id)),
    db.update(schema.users).set(location ?? { cityId: user.cityId, campusId: user.campusId }).where(eq(schema.users.id, user.id)),
  ]);
  if (location && user.cityId !== location.cityId) c.executionCtx.waitUntil(rejoinCohorts(c.env, user.id, location.cityId));
  return c.json(await loadMe(c.env, { ...user, ...location }));
});

/** People move. Builds before the combined save above still call this, so it stays until those are gone. */
me.put("/location", async (c) => {
  const user = c.get("user");
  if (!user.onboardedAt) throw fail(403, "onboarding_required");
  const input = await parseJson(c, locationSchema);
  const db = getDb(c.env);
  await requireLocation(db, input.cityId, input.campusId);
  const [updated] = await db.update(schema.users).set({ cityId: input.cityId, campusId: input.campusId }).where(eq(schema.users.id, user.id)).returning();
  if (user.cityId !== input.cityId) c.executionCtx.waitUntil(rejoinCohorts(c.env, user.id, input.cityId));
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
  await deleteAccount(c.env, c.get("user").id);
  return c.json({ ok: true });
});

export default me;
