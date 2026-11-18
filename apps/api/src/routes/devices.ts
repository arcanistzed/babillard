import { retireDeviceSchema, type SignedInPhone } from "@babillard/shared";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "../db";
import { fail, parseJson } from "../lib/http";
import { requireAuth } from "../middleware";
import type { AppEnv } from "../types";

/**
 * A person's own phones, and retiring one they've lost. Messages are sealed for every active phone
 * of everyone in a chat, so a retired phone gets no new ones. It keeps whatever it already had.
 */
const devices = new Hono<AppEnv>();
devices.use("*", requireAuth);

devices.get("/", async (c) => {
  const phones: SignedInPhone[] = await getDb(c.env)
    .select({ publicKey: schema.deviceKeys.publicKey, lastOpenedAt: schema.deviceKeys.createdAt })
    .from(schema.deviceKeys)
    .where(and(eq(schema.deviceKeys.userId, c.get("user").id), isNull(schema.deviceKeys.retiredAt)))
    .orderBy(desc(schema.deviceKeys.createdAt));
  return c.json(phones);
});

/**
 * Retires one of the caller's other phones. Sessions aren't tied to a phone, so this also ends every
 * session but the caller's: otherwise the lost phone would register its key again the next time it
 * opens, and that un-retires it. The person's other phones sign in again with an email code, and
 * keep their keys. Push tokens go too, for the same reason; the
 * caller's phone registers its own again.
 *
 * A phone can't retire itself: that's signing out, which keeps the key so history stays readable.
 * The server can't tell which phone is calling, so `thisDevice` only guards against an app bug.
 */
devices.post("/retire", async (c) => {
  const user = c.get("user");
  const { publicKey, thisDevice } = await parseJson(c, retireDeviceSchema);
  if (publicKey === thisDevice) throw fail(409, "this_device");
  const db = getDb(c.env);
  const [device] = await db
    .select({ publicKey: schema.deviceKeys.publicKey })
    .from(schema.deviceKeys)
    .where(and(eq(schema.deviceKeys.publicKey, publicKey), eq(schema.deviceKeys.userId, user.id), isNull(schema.deviceKeys.retiredAt)));
  if (!device) throw fail(404, "device_not_found");
  await db.batch([
    db.update(schema.deviceKeys).set({ retiredAt: Date.now() }).where(eq(schema.deviceKeys.publicKey, publicKey)),
    db.delete(schema.sessions).where(and(eq(schema.sessions.userId, user.id), ne(schema.sessions.id, c.get("sessionId")))),
    db.delete(schema.pushTokens).where(eq(schema.pushTokens.userId, user.id)),
  ]);
  return c.json({ ok: true });
});

export default devices;
