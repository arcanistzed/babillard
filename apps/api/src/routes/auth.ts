import { authStartSchema, authVerifySchema, institutionDomain } from "@babillard/shared";
import { requestLanguage } from "../lib/language";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { html } from "hono/html";
import { getDb, schema } from "../db";
import { isDevMode } from "../lib/config";
import { page } from "../lib/page";
import { sendLoginEmail } from "../lib/email";
import { fail, parseJson } from "../lib/http";
import { hmacHex, newId, randomCode, randomToken, safeEqual, sha256Hex } from "../lib/tokens";
import { requireAuth } from "../middleware";
import type { AppEnv } from "../types";
import { loadMe } from "./me";

const HOUR = 60 * 60 * 1000;
const LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_LINKS_PER_WINDOW = 3;
const MAX_CODE_ATTEMPTS = 5;

const auth = new Hono<AppEnv>();

function codeHash(secret: string, email: string, code: string): Promise<string> {
  return hmacHex(secret, `${email}:${code}`);
}

/** Slows one network hammering sign-in. Dev mode and the seed script sign in many people at once. */
const limitByIp = (binding: "SIGN_IN_START_LIMIT" | "SIGN_IN_VERIFY_LIMIT") =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!isDevMode(c.env)) {
      const key = c.req.header("cf-connecting-ip") ?? "unknown";
      const { success } = await c.env[binding].limit({ key });
      if (!success) throw fail(429, "too_many_attempts");
    }
    await next();
  });

auth.post("/start", limitByIp("SIGN_IN_START_LIMIT"), async (c) => {
  const { email } = await parseJson(c, authStartSchema);
  const db = getDb(c.env);
  const now = Date.now();

  const [recent] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.magicLinks)
    .where(and(eq(schema.magicLinks.email, email), gt(schema.magicLinks.createdAt, now - LINK_TTL_MS)));
  // Answering the same way keeps this from becoming a way to probe or flood an address.
  if (!isDevMode(c.env) && (recent?.count ?? 0) >= MAX_LINKS_PER_WINDOW) return c.json({ ok: true });

  // The last line of defence if someone spreads requests across many networks: it protects the bill and sender reputation.
  if (!isDevMode(c.env)) {
    const [hour] = await db.select({ count: sql<number>`count(*)` }).from(schema.magicLinks).where(gt(schema.magicLinks.createdAt, now - HOUR));
    if ((hour?.count ?? 0) >= Number(c.env.LOGIN_EMAIL_HOURLY_CAP)) {
      console.error(JSON.stringify({ event: "login_email_cap_reached", cap: c.env.LOGIN_EMAIL_HOURLY_CAP }));
      throw fail(503, "email_unavailable");
    }
  }

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
    await sendLoginEmail(c.env, email, code, `${c.env.PUBLIC_ORIGIN}/auth/link?token=${encodeURIComponent(token)}`, requestLanguage(c));
  } catch (error) {
    console.error(JSON.stringify({ event: "login_email_failed", error: String(error) }));
    throw fail(503, "email_unavailable");
  }
  return c.json({ ok: true });
});

auth.post("/verify", limitByIp("SIGN_IN_VERIFY_LIMIT"), async (c) => {
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
  const fr = requestLanguage(c) === "fr";
  return c.html(
    page(
      fr ? "Connexion" : "Sign in",
      html`<h1>${fr ? "Ouvrir Babillard" : "Open Babillard"}</h1>
        <p><a class="button" href="babillard://auth/link?token=${encodeURIComponent(token)}">${fr ? "Ouvrir l'application" : "Open the app"}</a></p>
        <p class="muted">${fr ? "Vous lisez ceci sur un autre appareil? Entrez plutôt dans l'application le code à six chiffres reçu par courriel." : "Reading this on another device? Type the six-digit code from your email into the app instead."}</p>`,
      fr ? "fr" : "en",
      { hidden: true },
    ),
  );
});

export default auth;
