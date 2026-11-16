import { fromBase64, mlsClaimSchema, mlsIdentitySchema, mlsKeyPackagesSchema, mlsSubmitSchema, readKeyPackage, toBase64 } from "@babillard/shared";
import { and, count, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema, type Db } from "../db";
import { fail, parseJson } from "../lib/http";
import { newId } from "../lib/tokens";
import { requireAuth, requireOnboarded } from "../middleware";
import type { AppEnv } from "../types";
import { requireMember, requireOpenMatch } from "./conversations";

/**
 * MLS group chat, still a prototype: every route answers 404 unless the Worker
 * runs with MLS_ENABLED=true. Production's wrangler.jsonc sets it to "false".
 *
 * The server never holds a key. It keeps each phone's public signing key and
 * key packages in D1, and each chat's ordered log in its ChatRoom Durable Object.
 */

const CIPHERSUITE = 3; // MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519
const MAX_KEY_PACKAGES_PER_DEVICE = 100;

const mls = new Hono<AppEnv>();
mls.use("*", async (c, next) => {
  if (c.env.MLS_ENABLED !== "true") throw fail(404, "not_found");
  await next();
});
mls.use("*", requireAuth, requireOnboarded);

/** The caller's own active phone, or a 404. */
async function ownDevice(db: Db, userId: string, deviceId: string) {
  const [device] = await db
    .select()
    .from(schema.deviceKeys)
    .where(and(eq(schema.deviceKeys.publicKey, deviceId), eq(schema.deviceKeys.userId, userId), isNull(schema.deviceKeys.retiredAt)));
  if (!device) throw fail(404, "device_not_found");
  return device;
}

/** Registers a phone's MLS signing key. Set once: a new key would change everyone's security code silently. */
mls.post("/identity", async (c) => {
  const user = c.get("user");
  const { deviceId, signatureKey } = await parseJson(c, mlsIdentitySchema);
  const db = getDb(c.env);
  const device = await ownDevice(db, user.id, deviceId);
  if (device.mlsSignatureKey && device.mlsSignatureKey !== signatureKey) throw fail(409, "identity_exists");
  if (!device.mlsSignatureKey) await db.update(schema.deviceKeys).set({ mlsSignatureKey: signatureKey }).where(eq(schema.deviceKeys.publicKey, deviceId));
  return c.json({ ok: true });
});

/** Stores key packages after checking they're this phone's, with its registered signing key. */
mls.post("/key-packages", async (c) => {
  const user = c.get("user");
  const input = await parseJson(c, mlsKeyPackagesSchema);
  const db = getDb(c.env);
  const device = await ownDevice(db, user.id, input.deviceId);
  if (!device.mlsSignatureKey) throw fail(409, "identity_missing");

  const check = (encoded: string) => {
    let parsed;
    try {
      parsed = readKeyPackage(fromBase64(encoded));
    } catch {
      throw fail(400, "invalid_key_package");
    }
    if (parsed.identity !== `${user.id}/${input.deviceId}` || toBase64(parsed.signatureKey) !== device.mlsSignatureKey || parsed.cipherSuite !== CIPHERSUITE) {
      throw fail(400, "key_package_mismatch");
    }
  };
  input.keyPackages.forEach(check);
  if (input.lastResort) check(input.lastResort);

  const [stored] = await db
    .select({ n: count() })
    .from(schema.mlsKeyPackages)
    .where(and(eq(schema.mlsKeyPackages.deviceId, input.deviceId), eq(schema.mlsKeyPackages.lastResort, false)));
  if ((stored?.n ?? 0) + input.keyPackages.length > MAX_KEY_PACKAGES_PER_DEVICE) throw fail(409, "too_many_key_packages");

  const now = Date.now();
  const rows = input.keyPackages.map((keyPackage) => ({ id: newId(), deviceId: input.deviceId, userId: user.id, keyPackage, lastResort: false, createdAt: now }));
  if (rows.length) await db.insert(schema.mlsKeyPackages).values(rows);
  if (input.lastResort) {
    await db.batch([
      db.delete(schema.mlsKeyPackages).where(and(eq(schema.mlsKeyPackages.deviceId, input.deviceId), eq(schema.mlsKeyPackages.lastResort, true))),
      db.insert(schema.mlsKeyPackages).values({ id: newId(), deviceId: input.deviceId, userId: user.id, keyPackage: input.lastResort, lastResort: true, createdAt: now }),
    ]);
  }
  return c.json({ available: (stored?.n ?? 0) + rows.length });
});

/** How many single-use packages a phone has left, so it knows when to upload more. */
mls.get("/key-packages/:deviceId", async (c) => {
  const user = c.get("user");
  const db = getDb(c.env);
  const deviceId = c.req.param("deviceId");
  await ownDevice(db, user.id, deviceId);
  const rows = await db
    .select({ lastResort: schema.mlsKeyPackages.lastResort, n: count() })
    .from(schema.mlsKeyPackages)
    .where(eq(schema.mlsKeyPackages.deviceId, deviceId))
    .groupBy(schema.mlsKeyPackages.lastResort);
  return c.json({ available: rows.find((row) => !row.lastResort)?.n ?? 0, lastResort: rows.some((row) => row.lastResort) });
});

/** Takes one key package for a phone. Single-use ones are deleted. The last-resort one is shared and stays. */
async function claim(db: Db, deviceId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [candidate] = await db
      .select({ id: schema.mlsKeyPackages.id })
      .from(schema.mlsKeyPackages)
      .where(and(eq(schema.mlsKeyPackages.deviceId, deviceId), eq(schema.mlsKeyPackages.lastResort, false)))
      .orderBy(schema.mlsKeyPackages.createdAt)
      .limit(1);
    if (!candidate) break;
    // Whoever deletes the row gets it, so two people adding the same phone never share a package.
    const [taken] = await db.delete(schema.mlsKeyPackages).where(eq(schema.mlsKeyPackages.id, candidate.id)).returning({ keyPackage: schema.mlsKeyPackages.keyPackage });
    if (taken) return taken.keyPackage;
  }
  const [fallback] = await db
    .select({ keyPackage: schema.mlsKeyPackages.keyPackage })
    .from(schema.mlsKeyPackages)
    .where(and(eq(schema.mlsKeyPackages.deviceId, deviceId), eq(schema.mlsKeyPackages.lastResort, true)));
  return fallback?.keyPackage ?? null;
}

async function memberOfOpenChat(c: { env: Env }, userId: string, conversationId: string) {
  const db = getDb(c.env);
  await requireMember(db, conversationId, userId);
  await requireOpenMatch(db, conversationId);
  return db;
}

/** Key packages for phones the caller wants to add. Only current members' registered phones qualify. */
mls.post("/conversations/:id/key-packages", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = await memberOfOpenChat(c, user.id, id);
  const { deviceIds } = await parseJson(c, mlsClaimSchema);
  const state = await c.env.CHAT_ROOM.getByName(id).mlsState(id);
  const owners = new Map(state.directory.map((device) => [device.deviceId, device.userId]));
  const keyPackages: { userId: string; deviceId: string; keyPackage: string }[] = [];
  const missing: string[] = [];
  for (const deviceId of new Set(deviceIds)) {
    const userId = owners.get(deviceId);
    if (!userId) throw fail(403, "not_a_member_device");
    const keyPackage = await claim(db, deviceId);
    if (keyPackage) keyPackages.push({ userId, deviceId, keyPackage });
    else missing.push(deviceId);
  }
  return c.json({ keyPackages, missing });
});

mls.get("/conversations/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  await memberOfOpenChat(c, user.id, id);
  return c.json(await c.env.CHAT_ROOM.getByName(id).mlsState(id));
});

/** A commit or a message. The Durable Object checks order and membership, and refuses with a reason the phone can act on. */
mls.post("/conversations/:id/messages", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = await parseJson(c, mlsSubmitSchema);
  const result = await c.env.CHAT_ROOM.getByName(id).mlsSubmit(id, user.id, input);
  if (!result.ok) {
    const conflict = ["stale_epoch", "pending_removal", "no_group"].includes(result.error);
    return c.json({ error: result.error, epoch: result.epoch }, conflict ? 409 : 403);
  }
  return c.json(result.entry, 201);
});

mls.get("/conversations/:id/messages", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  await memberOfOpenChat(c, user.id, id);
  const since = Number(c.req.query("since") ?? 0);
  const limit = Number(c.req.query("limit") ?? 200);
  return c.json(await c.env.CHAT_ROOM.getByName(id).mlsLog(Number.isInteger(since) && since >= 0 ? since : 0, Number.isInteger(limit) ? limit : 200));
});

/** The Welcome waiting for one of the caller's own phones. Read the log after `seq`. */
mls.get("/conversations/:id/welcome/:deviceId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = await memberOfOpenChat(c, user.id, id);
  const deviceId = c.req.param("deviceId");
  await ownDevice(db, user.id, deviceId);
  const welcome = await c.env.CHAT_ROOM.getByName(id).mlsWelcome(deviceId);
  if (!welcome) throw fail(404, "no_welcome");
  return c.json(welcome);
});

mls.get("/conversations/:id/group-info", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  await memberOfOpenChat(c, user.id, id);
  const info = await c.env.CHAT_ROOM.getByName(id).mlsGroupInfo();
  if (!info) throw fail(404, "no_group_info");
  return c.json(info);
});

export default mls;
