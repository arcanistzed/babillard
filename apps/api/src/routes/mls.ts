import { fromBase64, mlsClaimSchema, mlsHistoryKeySchema, mlsHistoryUploadSchema, mlsIdentitySchema, mlsKeyPackagesSchema, mlsSubmitSchema, readKeyPackage, toBase64 } from "@babillard/shared";
import { and, asc, count, eq, gt, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema, type Db } from "../db";
import { mlsMode } from "../lib/config";
import { fail, parseJson } from "../lib/http";
import { newId } from "../lib/tokens";
import { requireAuth, requireOnboarded } from "../middleware";
import type { AppEnv } from "../types";
import { requireMember, requireOpenMatch } from "./conversations";

/**
 * MLS group chat. Every route answers 404 unless MLS_ENABLED is "true" or "paused" (see mlsMode).
 * Production's wrangler.jsonc sets it to "false".
 *
 * The server never holds a key. It keeps each phone's public signing key and
 * key packages in D1, and each chat's ordered log in its ChatRoom Durable Object.
 */

const CIPHERSUITE = 3; // MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519
const MAX_KEY_PACKAGES_PER_DEVICE = 100;

const mls = new Hono<AppEnv>();
mls.use("*", async (c, next) => {
  if (mlsMode(c.env) === "off") throw fail(404, "not_found");
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

/**
 * Takes one key package for a phone. Single-use ones are deleted. The last-resort one is shared and
 * stays. With `fresh` false, only the last-resort one is offered.
 */
async function claim(db: Db, deviceId: string, fresh: boolean): Promise<string | null> {
  for (let attempt = 0; fresh && attempt < 3; attempt++) {
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

/**
 * Key packages for phones the caller wants to add. Only members' registered phones that aren't in the
 * group yet qualify, and each chat takes only a few fresh packages per phone in a while, so another
 * member can't use up someone's packages. Past that, the phone's last-resort package, or nothing.
 */
mls.post("/conversations/:id/key-packages", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const { success } = await c.env.MLS_CLAIM_LIMIT.limit({ key: user.id });
  if (!success) throw fail(429, "too_many_attempts");
  const db = await memberOfOpenChat(c, user.id, id);
  const { deviceIds } = await parseJson(c, mlsClaimSchema);
  const room = c.env.CHAT_ROOM.getByName(id);
  const state = await room.mlsState(id);
  const waiting = new Map(state.pendingAdds.map((device) => [device.deviceId, device.userId]));
  const wanted = [...new Set(deviceIds)];
  if (wanted.some((deviceId) => !waiting.has(deviceId))) throw fail(403, "not_waiting_to_join");
  const fresh = new Set(await room.mlsAllowClaims(wanted));
  const keyPackages: { userId: string; deviceId: string; keyPackage: string }[] = [];
  const missing: string[] = [];
  for (const deviceId of wanted) {
    const userId = waiting.get(deviceId)!;
    const keyPackage = await claim(db, deviceId, fresh.has(deviceId));
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
  const result = await c.env.CHAT_ROOM.getByName(id).mlsSubmit(id, user.id, input, mlsMode(c.env) === "on");
  if (!result.ok) {
    const conflict = ["stale_epoch", "pending_removal", "no_group", "not_ready"].includes(result.error);
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

/*
 * Backup v2: each person's MLS history, sealed on their phones under a history key the server never
 * sees. The server keeps which key it is, by fingerprint, so a person's phones agree on one, and
 * hands the sealed entries back only to their owner, and only for chats they're still in.
 */

const HISTORY_PAGE = 200;

async function historyKeyId(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ keyId: schema.mlsHistoryKeys.keyId }).from(schema.mlsHistoryKeys).where(eq(schema.mlsHistoryKeys.userId, userId));
  return row?.keyId ?? null;
}

mls.get("/history/key", async (c) => c.json({ keyId: await historyKeyId(getDb(c.env), c.get("user").id) }));

/**
 * Sets which key the history is under. Null turns history off and deletes it. A different key from
 * the one in place is refused unless `replace` says to start over, which deletes the old history.
 */
mls.post("/history/key", async (c) => {
  const user = c.get("user");
  const { keyId, replace } = await parseJson(c, mlsHistoryKeySchema);
  const db = getDb(c.env);
  const current = await historyKeyId(db, user.id);
  const clearHistory = db.delete(schema.mlsHistory).where(eq(schema.mlsHistory.userId, user.id));
  if (keyId === null) {
    await db.batch([clearHistory, db.delete(schema.mlsHistoryKeys).where(eq(schema.mlsHistoryKeys.userId, user.id))]);
    return c.json({ keyId: null });
  }
  if (current === keyId) return c.json({ keyId });
  if (current && !replace) throw fail(409, "history_key_exists");
  const now = Date.now();
  await db.batch([
    clearHistory,
    db.insert(schema.mlsHistoryKeys).values({ userId: user.id, keyId, createdAt: now }).onConflictDoUpdate({ target: schema.mlsHistoryKeys.userId, set: { keyId, createdAt: now } }),
  ]);
  return c.json({ keyId });
});

/**
 * Stores sealed entries under the caller's current key. An entry is kept only for a chat the caller
 * is in and a message in its log. Others come back in `rejected`, and the phone stops trying them.
 * The first copy of a message wins, since several of a person's phones upload the same one.
 */
mls.post("/history", async (c) => {
  const user = c.get("user");
  const { success } = await c.env.MLS_HISTORY_LIMIT.limit({ key: user.id });
  if (!success) throw fail(429, "too_many_attempts");
  const { keyId, entries } = await parseJson(c, mlsHistoryUploadSchema);
  const db = getDb(c.env);
  if ((await historyKeyId(db, user.id)) !== keyId) throw fail(409, "history_key_changed");

  const byChat = new Map<string, typeof entries>();
  for (const entry of entries) byChat.set(entry.conversationId, [...(byChat.get(entry.conversationId) ?? []), entry]);
  const memberships = await db
    .select({ conversationId: schema.conversationMembers.conversationId })
    .from(schema.conversationMembers)
    .where(and(eq(schema.conversationMembers.userId, user.id), inArray(schema.conversationMembers.conversationId, [...byChat.keys()])));
  const mine = new Set(memberships.map((row) => row.conversationId));

  const accepted: typeof entries = [];
  const rejected: { conversationId: string; seq: number }[] = [];
  for (const [conversationId, chatEntries] of byChat) {
    const messages = new Set(mine.has(conversationId) ? await c.env.CHAT_ROOM.getByName(conversationId).mlsApplicationSeqs(chatEntries.map((entry) => entry.seq)) : []);
    for (const entry of chatEntries) {
      if (messages.has(entry.seq)) accepted.push(entry);
      else rejected.push({ conversationId, seq: entry.seq });
    }
  }
  if (accepted.length) {
    const now = Date.now();
    await db
      .insert(schema.mlsHistory)
      .values(accepted.map((entry) => ({ userId: user.id, conversationId: entry.conversationId, seq: entry.seq, keyId, entry: entry.entry, createdAt: now })))
      .onConflictDoNothing();
  }
  return c.json({ stored: accepted.length, rejected });
});

/** The caller's sealed history for one chat they're in, after `after`, oldest first. */
mls.get("/history/:conversationId", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("conversationId");
  const db = getDb(c.env);
  await requireMember(db, conversationId, user.id);
  const keyId = await historyKeyId(db, user.id);
  if (!keyId) return c.json({ keyId: null, entries: [] });
  const after = Number(c.req.query("after") ?? 0);
  const rows = await db
    .select({ seq: schema.mlsHistory.seq, entry: schema.mlsHistory.entry })
    .from(schema.mlsHistory)
    .where(
      and(
        eq(schema.mlsHistory.userId, user.id),
        eq(schema.mlsHistory.conversationId, conversationId),
        eq(schema.mlsHistory.keyId, keyId),
        gt(schema.mlsHistory.seq, Number.isInteger(after) && after > 0 ? after : 0),
      ),
    )
    .orderBy(asc(schema.mlsHistory.seq))
    .limit(HISTORY_PAGE);
  return c.json({ keyId, entries: rows });
});

export default mls;
