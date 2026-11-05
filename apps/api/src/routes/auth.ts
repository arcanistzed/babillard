import { authStartSchema, authVerifySchema, institutionDomain } from "@ideas-match/shared";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { html } from "hono/html";
import { getDb, schema } from "../db";
import { isDevMode } from "../lib/config";
import { sendLoginEmail } from "../lib/email";
import { fail, parseJson } from "../lib/http";
import { hmacHex, newId, randomCode, randomToken, safeEqual, sha256Hex } from "../lib/tokens";
import { requireAuth } from "../middleware";
import type { AppEnv } from "../types";
import { loadMe } from "./me";

const LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_LINKS_PER_WINDOW = 3;
const MAX_CODE_ATTEMPTS = 5;

const auth = new Hono<AppEnv>();

function codeHash(secret: string, email: string, code: string): Promise<string> {
  return hmacHex(secret, `${email}:${code}`);
}

auth.post("/start", async (c) => {
  const { email } = await parseJson(c, authStartSchema);
  const db = getDb(c.env);
  const now = Date.now();

  const [recent] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.magicLinks)
    .where(and(eq(schema.magicLinks.email, email), gt(schema.magicLinks.createdAt, now - LINK_TTL_MS)));
  // Answering the same way keeps this from becoming a way to probe or flood an address.
  if (!isDevMode(c.env) && (recent?.count ?? 0) >= MAX_LINKS_PER_WINDOW) return c.json({ ok: true });

  const token = randomToken();
  const code = randomCode();
  await db.insert(schema.magicLinks).values({
    id: newId(),
    email,
    tokenHash: await sha256Hex(token),
    codeHash: await codeHash(c.env.AUTH_SECRET, email, code),
    expiresAt: now + LINK_TTL_MS,
    createdAt: now,
  });

  if (isDevMode(c.env)) return c.json({ ok: true, devCode: code, devToken: token });

  try {
    await sendLoginEmail(c.env, email, code, `${c.env.PUBLIC_ORIGIN}/auth/link?token=${encodeURIComponent(token)}`);
  } catch (error) {
    console.error(JSON.stringify({ event: "login_email_failed", error: String(error) }));
    throw fail(503, "email_unavailable");
  }
  return c.json({ ok: true });
});

auth.post("/verify", async (c) => {
  const input = await parseJson(c, authVerifySchema);
  const db = getDb(c.env);
  const now = Date.now();
  const links = schema.magicLinks;

  let linkId: string | null = null;
  let email: string | null = null;

  if ("token" in input) {
    const [link] = await db
      .select()
      .from(links)
      .where(and(eq(links.tokenHash, await sha256Hex(input.token)), isNull(links.usedAt), gt(links.expiresAt, now)));
    if (link) [linkId, email] = [link.id, link.email];
  } else {
    const [link] = await db
      .select()
      .from(links)
      .where(and(eq(links.email, input.email), isNull(links.usedAt), gt(links.expiresAt, now)))
      .orderBy(desc(links.createdAt))
      .limit(1);
    if (link && link.attempts < MAX_CODE_ATTEMPTS) {
      await db.update(links).set({ attempts: sql`${links.attempts} + 1` }).where(eq(links.id, link.id));
      if (safeEqual(link.codeHash, await codeHash(c.env.AUTH_SECRET, input.email, input.code))) {
        [linkId, email] = [link.id, link.email];
      }
    }
  }
  if (!linkId || !email) throw fail(401, "invalid_or_expired");

  const claimed = await db.update(links).set({ usedAt: now }).where(and(eq(links.id, linkId), isNull(links.usedAt))).returning({ id: links.id });
  if (claimed.length === 0) throw fail(401, "invalid_or_expired");

  const domain = institutionDomain(email);
  await db
    .insert(schema.users)
    .values({ id: newId(), email, verifiedInstitution: domain !== null, institutionDomain: domain, createdAt: now })
    .onConflictDoNothing();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) throw fail(500, "user_missing");
  if (user.status !== "active") throw fail(403, "account_unavailable");

  const token = randomToken();
  await db.insert(schema.sessions).values({ id: await sha256Hex(token), userId: user.id, expiresAt: now + SESSION_TTL_MS });
  return c.json({ token, me: await loadMe(c.env, user) });
});

auth.post("/logout", requireAuth, async (c) => {
  await getDb(c.env).delete(schema.sessions).where(eq(schema.sessions.id, c.get("sessionId")));
  return c.json({ ok: true });
});

/**
 * Where the emailed Universal Link lands if the app does not intercept it.
 * It only renders a page: signing in takes a POST from the app, so a mail
 * scanner that fetches this URL cannot use up the token.
 */
auth.get("/link", (c) => {
  const token = c.req.query("token") ?? "";
  return c.html(html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Ideas Match sign-in</title>
        <style>
          body { font: 16px/1.5 system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1rem; color: #1f2430; }
          a.button { display: inline-block; padding: 0.75rem 1.25rem; background: #1f2430; color: #fff; border-radius: 0.5rem; text-decoration: none; }
        </style>
      </head>
      <body>
        <h1>Open Ideas Match</h1>
        <p><a class="button" href="ideasmatch://auth/link?token=${encodeURIComponent(token)}">Open the app</a></p>
        <p>Reading this on another device? Type the six-digit code from your email into the app instead.</p>
      </body>
    </html>`);
});

export default auth;
