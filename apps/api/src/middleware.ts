import { and, eq, gt } from "drizzle-orm";
import { requestLanguage } from "./lib/language";
import { createMiddleware } from "hono/factory";
import { getDb, schema } from "./db";
import { fail } from "./lib/http";
import { sha256Hex } from "./lib/tokens";
import type { AppEnv } from "./types";

const ACTIVITY_RESOLUTION_MS = 24 * 60 * 60 * 1000;

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw fail(401, "unauthorized");

  const sessionId = await sha256Hex(token);
  const db = getDb(c.env);
  const [row] = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sessionId), gt(schema.sessions.expiresAt, Date.now())));
  if (!row || row.user.status !== "active") throw fail(401, "unauthorized");

  const now = Date.now();
  const language = requestLanguage(c);
  const updates = {
    ...(now - (row.user.lastActiveAt ?? 0) > ACTIVITY_RESOLUTION_MS ? { lastActiveAt: now, inactivityWarnedAt: null } : {}),
    ...(c.req.header("accept-language") && language !== row.user.language ? { language } : {}),
  };
  if (Object.keys(updates).length > 0) c.executionCtx.waitUntil(db.update(schema.users).set(updates).where(eq(schema.users.id, row.user.id)));

  c.set("user", row.user);
  c.set("sessionId", sessionId);
  await next();
});

export const requireOnboarded = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user").onboardedAt) throw fail(403, "onboarding_required");
  await next();
});
