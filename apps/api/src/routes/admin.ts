import { and, desc, eq, inArray, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { html } from "hono/html";
import { createMiddleware } from "hono/factory";
import { verifyWithJwks } from "hono/utils/jwt/jwt";
import { getDb, schema } from "../db";
import { isDevMode } from "../lib/config";
import { fail } from "../lib/http";
import { banUser, isUrgentReason, REASON_LABELS, sendConductWarning } from "../lib/moderation";
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
          .urgent { color: #b3261e; font-weight: 700; }
          .notice { padding: 0.5rem 0.75rem; border-radius: 0.5rem; background: #fdecea; color: #8c1d18; }
          .chat { list-style: none; margin: 0.5rem 0; padding: 0.5rem 0.75rem; background: #f4f5f8; border-radius: 0.5rem; }
          .chat li { margin: 0.2rem 0; }
          .chat .reported { font-weight: 700; color: #8c1d18; }
          .muted { color: #5f6675; }
          table { border-collapse: collapse; width: 100%; }
          td, th { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid #d9dce3; }
          input[type="search"] { padding: 0.35rem 0.5rem; min-width: 18rem; }
        </style>
      </head>
      <body>
        <nav><a href="/admin">Overview</a><a href="/admin/reports">Reports</a><a href="/admin/topics">Topics</a><a href="/admin/users">People</a></nav>
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

const ERRORS: Record<string, string> = {
  warning_failed: "The warning email didn't send, so the report is still open. Try again, or ban or resolve it instead.",
  no_recipient: "That account has no address to warn, because it's closed or banned. The report is still open.",
};

type Db = ReturnType<typeof getDb>;

async function namesOf(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: schema.profiles.userId, name: schema.profiles.displayName }).from(schema.profiles).where(inArray(schema.profiles.userId, ids));
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function reportCounts(db: Db, userId: string) {
  const [row] = await db
    .select({
      received: sql<number>`(SELECT count(*) FROM reports WHERE target_user_id = ${userId})`,
      actioned: sql<number>`(SELECT count(*) FROM reports WHERE target_user_id = ${userId} AND action IN ('warned', 'banned'))`,
      filed: sql<number>`(SELECT count(*) FROM reports WHERE reporter_id = ${userId})`,
    })
    .from(sql`(SELECT 1)`);
  return row ?? { received: 0, actioned: 0, filed: 0 };
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

admin.get("/reports", async (c) => {
  const db = getDb(c.env);
  const reports = await db.select().from(schema.reports).where(isNull(schema.reports.resolvedAt)).orderBy(desc(schema.reports.createdAt)).limit(50);
  // Urgent reasons come first, then newest.
  reports.sort((a, b) => Number(isUrgentReason(b.reason)) - Number(isUrgentReason(a.reason)));
  const error = ERRORS[c.req.query("error") ?? ""];

  const items = await Promise.all(
    reports.map(async (report) => {
      const stub = report.conversationId ? c.env.CHAT_ROOM.getByName(report.conversationId) : null;
      const messages = stub ? await stub.around(report.messageId) : [];
      const senderIds = messages.flatMap((message) => (message.senderId ? [message.senderId] : []));
      const [names, targetCounts, reporterCounts, [target]] = await Promise.all([
        namesOf(db, [...new Set([report.reporterId, report.targetUserId, ...senderIds])]),
        reportCounts(db, report.targetUserId),
        reportCounts(db, report.reporterId),
        db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, report.targetUserId)),
      ]);
      const earlier = targetCounts.received - 1;
      return html`<article>
        <p>
          <a href="/admin/users/${report.targetUserId}"><strong>${names.get(report.targetUserId) ?? "Former member"}</strong></a> (${target?.status ?? "missing"}),
          reported for <strong class="${isUrgentReason(report.reason) ? "urgent" : ""}">${REASON_LABELS[report.reason] ?? report.reason}</strong> on ${new Date(report.createdAt).toUTCString()}
        </p>
        <p>
          ${earlier > 0 ? html`<strong>${plural(earlier, "earlier report")}</strong>, ${targetCounts.actioned} acted on.` : "No earlier reports."}
          Reported by <a href="/admin/users/${report.reporterId}">${names.get(report.reporterId) ?? "Former member"}</a>, who has filed ${plural(reporterCounts.filed, "report")}.
        </p>
        ${report.note ? html`<p>Reporter's note: ${report.note}</p>` : ""}
        ${messages.length
          ? html`<ul class="chat">
              ${messages.map(
                (message) =>
                  html`<li class="${message.id === report.messageId ? "reported" : ""}">
                    ${message.senderId ? html`${names.get(message.senderId) ?? "Former member"}: ` : html`<span class="muted">App: </span>`}${message.body}
                  </li>`,
              )}
            </ul>`
          : ""}
        <form method="post" action="/admin/reports/${report.id}">
          <button name="action" value="resolved">Resolve</button>
          <button name="action" value="warned">Warn by email</button>
          <button name="action" value="banned">Ban</button>
        </form>
      </article>`;
    }),
  );
  return c.html(page("Open reports", html`${error ? html`<p class="notice">${error}</p>` : ""}${items.length ? items : html`<p>Nothing to review.</p>`}`));
});

function confirmBanPage(name: string, action: string) {
  return page(
    `Ban ${name}?`,
    html`<p>This signs them out everywhere and stops them signing back in. You can undo it from their page under People.</p>
      <form method="post" action="${action}">
        <input type="hidden" name="action" value="banned" />
        <input type="hidden" name="confirm" value="yes" />
        <button>Yes, ban ${name}</button>
      </form>
      <p><a href="/admin/reports">Cancel</a></p>`,
  );
}

admin.post("/reports/:id", async (c) => {
  const db = getDb(c.env);
  const form = await c.req.parseBody();
  const action = form.action;
  if (action !== "resolved" && action !== "warned" && action !== "banned") throw fail(400, "invalid_action");

  const [report] = await db.select().from(schema.reports).where(eq(schema.reports.id, c.req.param("id")));
  if (!report) throw fail(404, "report_not_found");
  if (report.resolvedAt) return c.redirect("/admin/reports");
  const target = report.targetUserId;

  if (action === "banned" && form.confirm !== "yes") {
    const names = await namesOf(db, [target]);
    return c.html(confirmBanPage(names.get(target) ?? "this person", `/admin/reports/${report.id}`));
  }

  if (action === "warned") {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, target));
    if (!user || user.status !== "active") return c.redirect("/admin/reports?error=no_recipient");
    try {
      await sendConductWarning(c.env, user.email);
    } catch (error) {
      console.error(JSON.stringify({ event: "warning_email_failed", error: String(error) }));
      return c.redirect("/admin/reports?error=warning_failed");
    }
    if (report.conversationId) {
      c.executionCtx.waitUntil(
        sendPush(c.env, [target], {
          title: "A note about your conduct",
          body: "Please keep conversations respectful, or your account may be closed.",
          data: { screen: "chat", id: report.conversationId },
        }),
      );
    }
  }
  if (action === "banned") await banUser(c.env, db, target);

  await db.update(schema.reports).set({ resolvedAt: Date.now(), action }).where(eq(schema.reports.id, report.id));
  return c.redirect("/admin/reports");
});

admin.get("/users", async (c) => {
  const db = getDb(c.env);
  const query = (c.req.query("q") ?? "").trim().slice(0, 100);
  // % and _ are wildcards in LIKE, so a search for them must not match everything.
  const pattern = `%${query.toLowerCase().replace(/[\\%_]/g, "")}%`;
  const rows = await db
    .select({ user: schema.users, name: schema.profiles.displayName })
    .from(schema.users)
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .where(query ? or(like(sql`lower(${schema.profiles.displayName})`, pattern), like(schema.users.email, pattern)) : undefined)
    .orderBy(desc(schema.users.createdAt))
    .limit(50);
  return c.html(
    page(
      "People",
      html`<form method="get" action="/admin/users">
          <input type="search" name="q" value="${query}" placeholder="Name or email" aria-label="Name or email" />
          <button>Search</button>
        </form>
        ${rows.length
          ? html`<table>
              <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Joined</th></tr></thead>
              <tbody>
                ${rows.map(
                  ({ user, name }) =>
                    html`<tr>
                      <td><a href="/admin/users/${user.id}">${name ?? "No profile"}</a></td>
                      <td>${user.email}</td>
                      <td>${user.status}</td>
                      <td>${new Date(user.createdAt).toISOString().slice(0, 10)}</td>
                    </tr>`,
                )}
              </tbody>
            </table>`
          : html`<p>Nobody found.</p>`}`,
    ),
  );
});

admin.get("/users/:id", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const [row] = await db
    .select({ user: schema.users, profile: schema.profiles, city: schema.localities.name })
    .from(schema.users)
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .leftJoin(schema.localities, eq(schema.localities.id, schema.users.cityId))
    .where(eq(schema.users.id, id));
  if (!row) throw fail(404, "person_not_found");
  const reports = await db.select().from(schema.reports).where(eq(schema.reports.targetUserId, id)).orderBy(desc(schema.reports.createdAt)).limit(50);
  const counts = await reportCounts(db, id);
  const name = row.profile?.displayName ?? "No profile";
  return c.html(
    page(
      name,
      html`<dl>
          <dt>Email</dt><dd>${row.user.email}</dd>
          <dt>Status</dt><dd>${row.user.status}</dd>
          <dt>City</dt><dd>${row.city ?? "Not set"}</dd>
          <dt>Joined</dt><dd>${new Date(row.user.createdAt).toISOString().slice(0, 10)}</dd>
          <dt>Reports filed</dt><dd>${counts.filed}</dd>
        </dl>
        ${row.user.status === "active"
          ? html`<form method="post" action="/admin/users/${id}/ban"><button>Ban</button></form>`
          : row.user.status === "banned"
            ? html`<form method="post" action="/admin/users/${id}/unban"><button>Unban</button></form>`
            : ""}
        <h2>Reports about them</h2>
        ${reports.length
          ? html`<table>
              <thead><tr><th>Date</th><th>Reason</th><th>Outcome</th><th>Note</th></tr></thead>
              <tbody>
                ${reports.map(
                  (report) =>
                    html`<tr>
                      <td>${new Date(report.createdAt).toISOString().slice(0, 10)}</td>
                      <td>${REASON_LABELS[report.reason] ?? report.reason}</td>
                      <td>${report.action ?? "Open"}</td>
                      <td>${report.note}</td>
                    </tr>`,
                )}
              </tbody>
            </table>`
          : html`<p>None.</p>`}`,
    ),
  );
});

admin.post("/users/:id/ban", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  if (!user) throw fail(404, "person_not_found");
  const form = await c.req.parseBody();
  if (form.confirm !== "yes") {
    const names = await namesOf(db, [id]);
    return c.html(confirmBanPage(names.get(id) ?? "this person", `/admin/users/${id}/ban`));
  }
  if (user.status === "active") await banUser(c.env, db, id);
  return c.redirect(`/admin/users/${id}`);
});

admin.post("/users/:id/unban", async (c) => {
  const id = c.req.param("id");
  // Only a ban can be undone. A deleted account stays deleted.
  await getDb(c.env).update(schema.users).set({ status: "active" }).where(and(eq(schema.users.id, id), eq(schema.users.status, "banned")));
  return c.redirect(`/admin/users/${id}`);
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
