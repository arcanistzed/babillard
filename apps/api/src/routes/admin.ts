import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { html } from "hono/html";
import { createMiddleware } from "hono/factory";
import { verifyWithJwks } from "hono/utils/jwt/jwt";
import { getDb, schema } from "../db";
import { isDevMode } from "../lib/config";
import { fail } from "../lib/http";
import { sendPush } from "../lib/push";
import type { AppEnv } from "../types";
import { joinCohort } from "./deck";

/**
 * Cloudflare Access protects /admin at the edge, but the Worker is also
 * reachable on other hostnames, so it checks the signed Access token itself.
 * It fails closed when Access is not configured.
 */
const requireAccess = createMiddleware<AppEnv>(async (c, next) => {
  if (isDevMode(c.env)) return next();
  const { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } = c.env;
  const token = c.req.header("cf-access-jwt-assertion");
  if (!team || !aud || !token) throw fail(403, "forbidden");
  try {
    await verifyWithJwks(token, {
      jwks_uri: `https://${team}/cdn-cgi/access/certs`,
      allowedAlgorithms: ["RS256"],
      verification: { aud, iss: `https://${team}` },
    });
  } catch {
    throw fail(403, "forbidden");
  }
  await next();
});

function page(title: string, body: unknown) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} · Ideas Match admin</title>
        <style>
          body { font: 15px/1.5 system-ui, sans-serif; max-width: 56rem; margin: 2rem auto; padding: 0 1rem; color: #1f2430; }
          nav a { margin-right: 1rem; }
          article { border: 1px solid #d9dce3; border-radius: 0.5rem; padding: 0.75rem 1rem; margin: 0.75rem 0; }
          blockquote { margin: 0.5rem 0; padding-left: 0.75rem; border-left: 3px solid #d9dce3; color: #4b5262; }
          button { margin-right: 0.5rem; padding: 0.35rem 0.75rem; }
          dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; }
          dd { margin: 0; font-variant-numeric: tabular-nums; }
        </style>
      </head>
      <body>
        <nav><a href="/admin">Overview</a><a href="/admin/reports">Reports</a><a href="/admin/topics">Topics</a></nav>
        <h1>${title}</h1>
        ${body}
      </body>
    </html>`;
}

const admin = new Hono<AppEnv>();
admin.use("*", requireAccess, csrf());

admin.get("/", async (c) => {
  const db = getDb(c.env);
  const count = async (query: Promise<{ count: number }[]>) => (await query)[0]?.count ?? 0;
  const counter = sql<number>`count(*)`;
  const [members, matches, groups, confirmed, met, openReports, pendingTopics] = await Promise.all([
    count(db.select({ count: counter }).from(schema.users).where(and(eq(schema.users.status, "active"), isNotNull(schema.users.onboardedAt)))),
    count(db.select({ count: counter }).from(schema.matches)),
    count(db.select({ count: counter }).from(schema.conversations).where(eq(schema.conversations.kind, "group"))),
    count(db.select({ count: counter }).from(schema.meetups).where(sql`${schema.meetups.state} IN ('confirmed', 'done')`)),
    count(db.select({ count: sql<number>`count(DISTINCT ${schema.meetupResponses.meetupId})` }).from(schema.meetupResponses).where(eq(schema.meetupResponses.didMeet, true))),
    count(db.select({ count: counter }).from(schema.reports).where(isNull(schema.reports.resolvedAt))),
    count(db.select({ count: counter }).from(schema.topics).where(eq(schema.topics.status, "pending"))),
  ]);
  return c.html(
    page(
      "Overview",
      html`<dl>
        <dt><strong>Meetups that really happened</strong></dt><dd><strong>${met}</strong></dd>
        <dt>Meetups confirmed</dt><dd>${confirmed}</dd>
        <dt>Matches</dt><dd>${matches}</dd>
        <dt>Groups</dt><dd>${groups}</dd>
        <dt>Members</dt><dd>${members}</dd>
        <dt>Open reports</dt><dd>${openReports}</dd>
        <dt>Topics awaiting review</dt><dd>${pendingTopics}</dd>
      </dl>`,
    ),
  );
});

admin.get("/reports", async (c) => {
  const db = getDb(c.env);
  const rows = await db
    .select({ report: schema.reports, targetName: schema.profiles.displayName, targetStatus: schema.users.status })
    .from(schema.reports)
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.reports.targetUserId))
    .leftJoin(schema.users, eq(schema.users.id, schema.reports.targetUserId))
    .where(isNull(schema.reports.resolvedAt))
    .orderBy(desc(schema.reports.createdAt))
    .limit(100);

  const items = await Promise.all(
    rows.map(async ({ report, targetName, targetStatus }) => {
      const quoted =
        report.conversationId && report.messageId ? await c.env.CHAT_ROOM.getByName(report.conversationId).getMessage(report.messageId) : null;
      return html`<article>
        <p><strong>${targetName ?? "Unknown"}</strong> (${targetStatus ?? "missing"}), reported for <strong>${report.reason}</strong> on ${new Date(report.createdAt).toUTCString()}</p>
        ${quoted ? html`<blockquote>${quoted.body}</blockquote>` : ""}
        ${report.note ? html`<p>Reporter's note: ${report.note}</p>` : ""}
        <form method="post" action="/admin/reports/${report.id}">
          <button name="action" value="resolved">Resolve</button>
          <button name="action" value="warned">Warn</button>
          <button name="action" value="banned">Ban</button>
        </form>
      </article>`;
    }),
  );
  return c.html(page("Open reports", items.length ? items : html`<p>Nothing to review.</p>`));
});

admin.post("/reports/:id", async (c) => {
  const db = getDb(c.env);
  const form = await c.req.parseBody();
  const action = form.action;
  if (action !== "resolved" && action !== "warned" && action !== "banned") throw fail(400, "invalid_action");

  const [report] = await db.select().from(schema.reports).where(eq(schema.reports.id, c.req.param("id")));
  if (!report) throw fail(404, "report_not_found");
  await db.update(schema.reports).set({ resolvedAt: Date.now(), action }).where(eq(schema.reports.id, report.id));

  const target = report.targetUserId;
  if (action === "warned") {
    await sendPush(c.env, [target], {
      title: "A note about your conduct",
      body: "Someone reported a recent interaction. Please keep conversations respectful, or your account may be closed.",
      data: { screen: "chat", id: report.conversationId ?? "" },
    });
  }
  if (action === "banned") {
    const memberships = await db
      .select({ id: schema.conversationMembers.conversationId })
      .from(schema.conversationMembers)
      .where(eq(schema.conversationMembers.userId, target));
    await db.batch([
      db.update(schema.users).set({ status: "banned" }).where(eq(schema.users.id, target)),
      db.delete(schema.sessions).where(eq(schema.sessions.userId, target)),
      db.delete(schema.pushTokens).where(eq(schema.pushTokens.userId, target)),
    ]);
    await Promise.all(memberships.map((row) => c.env.CHAT_ROOM.getByName(row.id).kick(target)));
  }
  return c.redirect("/admin/reports");
});

admin.get("/topics", async (c) => {
  const rows = await getDb(c.env).select().from(schema.topics).where(eq(schema.topics.status, "pending")).orderBy(desc(schema.topics.createdAt)).limit(100);
  const items = rows.map(
    (topic) => html`<article>
      <p><strong>${topic.title}</strong> (${topic.kind}; ${topic.fieldTags.join(", ")})</p>
      ${topic.blurb ? html`<p>${topic.blurb}</p>` : ""}
      <form method="post" action="/admin/topics/${topic.id}">
        <button name="action" value="approved">Approve</button>
        <button name="action" value="rejected">Reject</button>
      </form>
    </article>`,
  );
  return c.html(page("Topics awaiting review", items.length ? items : html`<p>Nothing to review.</p>`));
});

admin.post("/topics/:id", async (c) => {
  const db = getDb(c.env);
  const form = await c.req.parseBody();
  const action = form.action;
  if (action !== "approved" && action !== "rejected") throw fail(400, "invalid_action");

  const [topic] = await db.update(schema.topics).set({ status: action }).where(eq(schema.topics.id, c.req.param("id"))).returning();
  if (!topic) throw fail(404, "topic_not_found");

  // The submitter may have swiped right while it was pending. That swipe counts once it's approved.
  if (action === "approved") {
    const swipers = await db
      .select({ userId: schema.topicSwipes.userId, stance: schema.topicSwipes.stance, cityId: schema.users.cityId })
      .from(schema.topicSwipes)
      .innerJoin(schema.users, eq(schema.users.id, schema.topicSwipes.userId))
      .where(and(eq(schema.topicSwipes.topicId, topic.id), eq(schema.topicSwipes.direction, "right")));
    for (const swiper of swipers) {
      if (swiper.cityId) await joinCohort(c.env, { userId: swiper.userId, cityId: swiper.cityId, topic, stance: swiper.stance });
    }
  }
  return c.redirect("/admin/topics");
});

export default admin;
