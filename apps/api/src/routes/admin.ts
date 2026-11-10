import { defaultOpeners, FIELD_LABELS, FIELDS, type Field } from "@babillard/shared";
import { and, desc, eq, gt, inArray, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { html } from "hono/html";
import { createMiddleware } from "hono/factory";
import { verifyWithJwks } from "hono/utils/jwt/jwt";
import { getDb, schema } from "../db";
import { isDevMode } from "../lib/config";
import { fail } from "../lib/http";
import { avatarUrl } from "../lib/config";
import { aiAvailable, draftForModerator, type PlaceChoice } from "../lib/ai";
import { banUser, isUrgentReason, logModeration, REASON_LABELS, sendConductWarning } from "../lib/moderation";
import { sendPush } from "../lib/push";
import type { AppEnv } from "../types";
import { joinCohort } from "./deck";

/**
 * Cloudflare Access protects /admin at the edge, but the Worker is also
 * reachable on other hostnames, so it checks the signed Access token itself.
 * It fails closed when Access is not configured.
 */
const requireAccess = createMiddleware<AppEnv>(async (c, next) => {
  if (isDevMode(c.env)) {
    c.set("adminEmail", "local development");
    return next();
  }
  const { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } = c.env;
  const token = c.req.header("cf-access-jwt-assertion");
  if (!team || !aud || !token) throw fail(403, "forbidden");
  try {
    const payload = await verifyWithJwks(token, {
      jwks_uri: `https://${team}/cdn-cgi/access/certs`,
      allowedAlgorithms: ["RS256"],
      verification: { aud, iss: `https://${team}` },
    });
    c.set("adminEmail", typeof payload.email === "string" ? payload.email : "unknown");
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
        <title>${title} · Babillard admin</title>
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
          .stack { display: grid; gap: 0.5rem; }
          .stack label { display: grid; gap: 0.2rem; }
          .stack input:not([type="checkbox"]), .stack textarea, .stack select { font: inherit; padding: 0.35rem 0.5rem; }
          .stack .check { display: inline-flex; gap: 0.3rem; margin-right: 0.75rem; }
          fieldset { border: 1px solid #d9dce3; border-radius: 0.5rem; }
          pre { overflow-x: auto; font-size: 0.8rem; }
        </style>
      </head>
      <body>
        <nav><a href="/admin">Overview</a><a href="/admin/reports">Reports</a><a href="/admin/topics">Topics</a><a href="/admin/takeaways">Takeaways</a><a href="/admin/users">People</a><a href="/admin/history">History</a><a href="/admin/crashes">Crashes</a></nav>
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

/** One query for any number of people, so the reports page doesn't run a query per row. */
async function reportCounts(db: Db, userIds: string[]) {
  const counts = new Map(userIds.map((id) => [id, { received: 0, actioned: 0, filed: 0 }]));
  if (userIds.length === 0) return counts;
  const [received, filed] = await Promise.all([
    db
      .select({ id: schema.reports.targetUserId, count: sql<number>`count(*)`, actioned: sql<number>`sum(${schema.reports.action} IN ('warned', 'banned'))` })
      .from(schema.reports)
      .where(inArray(schema.reports.targetUserId, userIds))
      .groupBy(schema.reports.targetUserId),
    db
      .select({ id: schema.reports.reporterId, count: sql<number>`count(*)` })
      .from(schema.reports)
      .where(inArray(schema.reports.reporterId, userIds))
      .groupBy(schema.reports.reporterId),
  ]);
  for (const row of received) Object.assign(counts.get(row.id)!, { received: row.count, actioned: row.actioned ?? 0 });
  for (const row of filed) counts.get(row.id)!.filed = row.count;
  return counts;
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

  const people = [...new Set(reports.flatMap((report) => [report.reporterId, report.targetUserId]))];
  const senders = reports.flatMap((report) => (report.evidence ?? []).map((message) => message.senderId));
  const [names, counts, statuses] = await Promise.all([
    namesOf(db, [...new Set([...people, ...senders])]),
    reportCounts(db, people),
    people.length ? db.select({ id: schema.users.id, status: schema.users.status }).from(schema.users).where(inArray(schema.users.id, people)) : [],
  ]);
  const statusOf = new Map(statuses.map((row) => [row.id, row.status]));

  const items = reports.map((report) => {
    const messages = report.evidence ?? [];
    const targetCounts = counts.get(report.targetUserId)!;
    const reporterCounts = counts.get(report.reporterId)!;
    const earlier = targetCounts.received - 1;
    return html`<article>
      <p>
        <a href="/admin/users/${report.targetUserId}"><strong>${names.get(report.targetUserId) ?? "Former member"}</strong></a> (${statusOf.get(report.targetUserId) ?? "missing"}),
        reported for <strong class="${isUrgentReason(report.reason) ? "urgent" : ""}">${REASON_LABELS[report.reason] ?? report.reason}</strong> on ${new Date(report.createdAt).toUTCString()}
      </p>
      <p>
        ${earlier > 0 ? html`<strong>${plural(earlier, "earlier report")}</strong>, ${targetCounts.actioned} acted on.` : "No earlier reports."}
        Reported by <a href="/admin/users/${report.reporterId}">${names.get(report.reporterId) ?? "Former member"}</a>, who has filed ${plural(reporterCounts.filed, "report")}.
      </p>
      ${report.note ? html`<p>Reporter's note: ${report.note}</p>` : ""}
      ${messages.length
        ? html`<p class="muted">Shared by the reporter's phone and checked against the stored messages.</p>
            <ul class="chat">
              ${messages.map((message) => html`<li class="${message.id === report.messageId ? "reported" : ""}">${names.get(message.senderId) ?? "Former member"}: ${message.body}</li>`)}
            </ul>`
        : ""}
      <form method="post" action="/admin/reports/${report.id}">
        <button name="action" value="resolved">Resolve</button>
        <button name="action" value="warned">Warn by email</button>
        <button name="action" value="banned">Ban</button>
      </form>
    </article>`;
  });
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
      await sendConductWarning(c.env, user.email, user.language);
    } catch (error) {
      console.error(JSON.stringify({ event: "warning_email_failed", error: String(error) }));
      return c.redirect("/admin/reports?error=warning_failed");
    }
    if (report.conversationId) {
      c.executionCtx.waitUntil(
        sendPush(c.env, [target], {
          title: "A note about your conduct",
          body: "Please keep conversations respectful, or your account may be closed.",
          fr: { title: "Un mot sur votre comportement", body: "Merci de garder vos échanges respectueux, sinon votre compte pourrait être fermé." },
          data: { screen: "chat", id: report.conversationId },
        }),
      );
    }
  }
  if (action === "banned") await banUser(c.env, db, target);

  await db.update(schema.reports).set({ resolvedAt: Date.now(), action }).where(eq(schema.reports.id, report.id));
  await logModeration(db, c.get("adminEmail"), action, "report", report.id, `About ${target}. Reason: ${report.reason}.`);
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
  const counts = (await reportCounts(db, [id])).get(id)!;
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
        ${row.profile?.avatarKey
          ? html`<h2>Photo</h2>
              <p><img src="${avatarUrl(c.env, row.profile.avatarKey) ?? ""}" alt="" width="160" /></p>
              <form method="post" action="/admin/users/${id}/remove-photo"><button>Remove photo</button></form>`
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

admin.post("/users/:id/remove-photo", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const [profile] = await db.select({ key: schema.profiles.avatarKey }).from(schema.profiles).where(eq(schema.profiles.userId, id));
  if (!profile) throw fail(404, "person_not_found");
  if (profile.key) {
    await c.env.AVATARS.delete(profile.key);
    await db.update(schema.profiles).set({ avatarKey: null }).where(eq(schema.profiles.userId, id));
    await logModeration(db, c.get("adminEmail"), "removed photo", "user", id);
  }
  return c.redirect(`/admin/users/${id}`);
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
  if (user.status === "active") {
    await banUser(c.env, db, id);
    await logModeration(db, c.get("adminEmail"), "banned", "user", id);
  }
  return c.redirect(`/admin/users/${id}`);
});

admin.post("/users/:id/unban", async (c) => {
  const id = c.req.param("id");
  // Only a ban can be undone. A deleted account stays deleted.
  const db = getDb(c.env);
  const unbanned = await db.update(schema.users).set({ status: "active" }).where(and(eq(schema.users.id, id), eq(schema.users.status, "banned"))).returning({ id: schema.users.id });
  if (unbanned.length > 0) await logModeration(db, c.get("adminEmail"), "unbanned", "user", id);
  return c.redirect(`/admin/users/${id}`);
});

const MAX_OPENERS = 5;
const TOPIC_ERRORS: Record<string, string> = { invalid: "A topic needs a title of 4 to 120 characters, at least one field, and at least one opener." };

/** Where an approved suggestion can appear, from narrowest to widest. Suggestions start in the suggester's city. */
function placeOptions(origin: { cityId: string | null; cityName: string | null; region: string | null; countryCode: string | null }) {
  const options: { value: string; label: string; choice: PlaceChoice }[] = [];
  if (origin.cityId) options.push({ value: origin.cityId, label: `Only ${origin.cityName ?? origin.cityId}`, choice: "city" });
  if (origin.region && origin.countryCode) options.push({ value: `${origin.countryCode}:${origin.region}`, label: `All of ${origin.region}`, choice: "province" });
  if (origin.countryCode) options.push({ value: origin.countryCode, label: `All of ${origin.countryCode === "CA" ? "Canada" : origin.countryCode}`, choice: "country" });
  options.push({ value: "", label: "Everywhere", choice: "everywhere" });
  return options;
}

async function pendingTopics(db: ReturnType<typeof getDb>) {
  return db
    .select({ topic: schema.topics, cityId: schema.localities.id, cityName: schema.localities.name, region: schema.localities.region, countryCode: schema.localities.countryCode })
    .from(schema.topics)
    .leftJoin(schema.users, eq(schema.users.id, schema.topics.createdBy))
    .leftJoin(schema.localities, eq(schema.localities.id, schema.users.cityId))
    .where(eq(schema.topics.status, "pending"))
    .orderBy(desc(schema.topics.createdAt))
    .limit(100);
}

admin.get("/topics", async (c) => {
  const rows = await pendingTopics(getDb(c.env));
  const error = TOPIC_ERRORS[c.req.query("error") ?? ""];
  // A draft is only requested for one topic at a time, when the moderator asks for it.
  const draftId = c.req.query("draft");
  const draftRow = draftId ? rows.find((row) => row.topic.id === draftId) : undefined;
  const draft = draftRow
    ? await draftForModerator(c.env, {
        kind: draftRow.topic.kind,
        title: draftRow.topic.title,
        blurb: draftRow.topic.blurb,
        fieldTags: draftRow.topic.fieldTags as Field[],
        city: draftRow.cityName ?? "",
        province: draftRow.region ?? "",
      })
    : null;
  const items = rows.map((row) => {
    const topic = row.topic;
    const drafted = draft && draftRow?.topic.id === topic.id ? draft : null;
    const kind = drafted?.kind ?? topic.kind;
    const title = drafted?.title ?? topic.title;
    const openers = drafted?.openers.length ? drafted.openers : topic.openers.length ? topic.openers : defaultOpeners(topic.kind, topic.title);
    const fr = drafted?.fr ?? topic.fr ?? { title: "", blurb: "", openers: [] };
    const options = placeOptions(row);
    const chosen = drafted ? options.find((option) => option.choice === drafted.place) : undefined;
    const selected = chosen?.value ?? topic.place ?? options[0]?.value ?? "";
    return html`<article id="topic-${topic.id}">
      <form method="post" action="/admin/topics/${topic.id}" class="stack">
        ${drafted ? html`<p class="notice">Drafted with AI. Check it before approving. Suggested place: ${chosen?.label ?? "Everywhere"}. ${drafted.placeReason}</p>` : ""}
        ${draftId === topic.id && !drafted ? html`<p class="notice">The AI draft didn't come back. Fill it in by hand.</p>` : ""}
        <label>Title <input name="title" value="${title}" maxlength="120" required /></label>
        <label>Blurb <textarea name="blurb" rows="2" maxlength="400">${drafted?.blurb ?? topic.blurb}</textarea></label>
        <label>Kind
          <select name="kind">
            <option value="interest" ${kind === "interest" ? "selected" : ""}>Interest</option>
            <option value="question" ${kind === "question" ? "selected" : ""}>Question</option>
          </select>
        </label>
        <fieldset>
          <legend>Fields</legend>
          ${FIELDS.map((field) => html`<label class="check"><input type="checkbox" name="fieldTags" value="${field}" ${topic.fieldTags.includes(field) ? "checked" : ""} /> ${FIELD_LABELS[field]}</label>`)}
        </fieldset>
        <label>Conversation openers, one per line <textarea name="openers" rows="3">${openers.join("\n")}</textarea></label>
        <fieldset>
          <legend>French</legend>
          <label>Titre <input name="frTitle" value="${fr.title}" maxlength="120" /></label>
          <label>Description <textarea name="frBlurb" rows="2" maxlength="400">${fr.blurb}</textarea></label>
          <label>Amorces de conversation, une par ligne <textarea name="frOpeners" rows="3">${fr.openers.join("\n")}</textarea></label>
        </fieldset>
        <label>Where it appears
          <select name="place">
            ${options.map((option) => html`<option value="${option.value}" ${option.value === selected ? "selected" : ""}>${option.label}</option>`)}
          </select>
        </label>
        <p>
          <button name="action" value="approved">Approve</button>
          <button name="action" value="rejected">Reject</button>
          ${aiAvailable(c.env) ? html`<a href="/admin/topics?draft=${topic.id}#topic-${topic.id}">Draft with AI</a>` : ""}
        </p>
      </form>
    </article>`;
  });
  return c.html(page("Topics awaiting review", html`${error ? html`<p class="notice">${error}</p>` : ""}${items.length ? items : html`<p>Nothing to review.</p>`}`));
});

admin.post("/topics/:id", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const form = await c.req.parseBody({ all: true });
  const action = form.action;
  if (action !== "approved" && action !== "rejected") throw fail(400, "invalid_action");

  const [existing] = await db.select().from(schema.topics).where(eq(schema.topics.id, id));
  if (!existing) throw fail(404, "topic_not_found");

  if (action === "rejected") {
    await db.update(schema.topics).set({ status: "rejected" }).where(eq(schema.topics.id, id));
    await logModeration(db, c.get("adminEmail"), "rejected", "topic", id, existing.title);
    return c.redirect("/admin/topics");
  }

  const title = String(form.title ?? existing.title).trim();
  const blurb = String(form.blurb ?? existing.blurb).trim().slice(0, 400);
  const kind = form.kind === "question" || form.kind === "interest" ? form.kind : existing.kind;
  const submittedTags = form.fieldTags === undefined ? existing.fieldTags : ([form.fieldTags].flat() as string[]);
  const fieldTags = submittedTags.filter((tag) => (FIELDS as readonly string[]).includes(tag)).slice(0, 4);
  const submittedOpeners = form.openers === undefined ? defaultOpeners(kind, title).join("\n") : String(form.openers);
  const openers = submittedOpeners.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, MAX_OPENERS).map((line) => line.slice(0, 200));
  if (title.length < 4 || title.length > 120 || fieldTags.length === 0 || openers.length === 0) return c.redirect("/admin/topics?error=invalid");

  const lines = (value: unknown) => String(value ?? "").split("\n").map((line) => line.trim()).filter(Boolean).slice(0, MAX_OPENERS).map((line) => line.slice(0, 200));
  const frTitle = String(form.frTitle ?? "").trim().slice(0, 120);
  const fr = frTitle ? { title: frTitle, blurb: String(form.frBlurb ?? "").trim().slice(0, 400), openers: lines(form.frOpeners) } : existing.fr;
  const [origin] = (await pendingTopics(db)).filter((row) => row.topic.id === id);
  const allowed = origin ? placeOptions(origin) : [];
  const requested = form.place === undefined ? existing.place ?? "" : String(form.place);
  const placeOption = allowed.find((option) => option.value === requested);
  const place = placeOption ? placeOption.value || null : existing.place;

  const [topic] = await db.update(schema.topics).set({ status: "approved", title, blurb, kind, fieldTags, openers, fr, place }).where(eq(schema.topics.id, id)).returning();
  const edits = [title !== existing.title && "title", blurb !== existing.blurb && "blurb", kind !== existing.kind && "kind", fieldTags.join() !== existing.fieldTags.join() && "fields", JSON.stringify(fr) !== JSON.stringify(existing.fr) && "French"].filter(Boolean);
  await logModeration(db, c.get("adminEmail"), "approved", "topic", id, `${title}${edits.length ? ` (edited ${edits.join(", ")})` : ""}, shown ${placeOption?.label.toLowerCase() ?? "where it was"}`);

  // The submitter may have swiped right while it was pending. That swipe counts once it's approved.
  const swipers = await db
    .select({ userId: schema.topicSwipes.userId, stance: schema.topicSwipes.stance, cityId: schema.users.cityId })
    .from(schema.topicSwipes)
    .innerJoin(schema.users, eq(schema.users.id, schema.topicSwipes.userId))
    .where(and(eq(schema.topicSwipes.topicId, id), eq(schema.topicSwipes.direction, "right")));
  for (const swiper of swipers) {
    if (swiper.cityId) await joinCohort(c.env, { userId: swiper.userId, cityId: swiper.cityId, topic: topic!, stance: swiper.stance });
  }
  return c.redirect("/admin/topics");
});

admin.get("/takeaways", async (c) => {
  const rows = await getDb(c.env)
    .select({
      meetupId: schema.meetupOutcomes.meetupId,
      userId: schema.meetupOutcomes.userId,
      takeaway: schema.meetupOutcomes.takeaway,
      language: schema.meetupOutcomes.language,
      createdAt: schema.meetupOutcomes.createdAt,
      topicTitle: schema.topics.title,
    })
    .from(schema.meetupOutcomes)
    .innerJoin(schema.meetups, eq(schema.meetups.id, schema.meetupOutcomes.meetupId))
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.meetups.conversationId))
    .leftJoin(schema.topics, eq(schema.topics.id, schema.conversations.topicId))
    .where(eq(schema.meetupOutcomes.takeawayStatus, "pending"))
    .orderBy(schema.meetupOutcomes.createdAt)
    .limit(100);
  const items = rows.map(
    (row) => html`<article>
      <p class="muted">${row.topicTitle ?? "No topic"} · ${row.language === "fr" ? "French" : "English"} · ${new Date(row.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC · <a href="/admin/users/${row.userId}">writer</a></p>
      <blockquote>${row.takeaway}</blockquote>
      <form method="post" action="/admin/takeaways/${row.meetupId}/${row.userId}">
        <button name="action" value="approved">Show on the topic page</button>
        <button name="action" value="rejected">Reject</button>
      </form>
    </article>`,
  );
  return c.html(
    page(
      "Takeaways awaiting review",
      html`<p class="muted">Approved lines appear on the public topic page without a name. Reject anything that identifies someone, or that isn't about the discussion.</p>
        ${items.length ? items : html`<p>Nothing to review.</p>`}`,
    ),
  );
});

admin.post("/takeaways/:meetupId/:userId", async (c) => {
  const db = getDb(c.env);
  const { meetupId, userId } = c.req.param();
  const action = (await c.req.parseBody()).action;
  if (action !== "approved" && action !== "rejected") throw fail(400, "invalid_action");
  const [row] = await db
    .update(schema.meetupOutcomes)
    .set({ takeawayStatus: action, reviewedAt: Date.now() })
    .where(and(eq(schema.meetupOutcomes.meetupId, meetupId), eq(schema.meetupOutcomes.userId, userId), eq(schema.meetupOutcomes.takeawayStatus, "pending")))
    .returning({ takeaway: schema.meetupOutcomes.takeaway });
  if (row) await logModeration(db, c.get("adminEmail"), action, "takeaway", `${meetupId}:${userId}`, row.takeaway ?? "");
  return c.redirect("/admin/takeaways");
});

admin.get("/history", async (c) => {
  const rows = await getDb(c.env).select().from(schema.moderationLog).orderBy(desc(schema.moderationLog.createdAt)).limit(200);
  return c.html(
    page(
      "History",
      rows.length
        ? html`<table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>On</th><th>Detail</th></tr></thead>
            <tbody>
              ${rows.map(
                (row) => html`<tr>
                  <td>${new Date(row.createdAt).toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td>${row.actor}</td>
                  <td>${row.action}</td>
                  <td>${row.targetType === "user" ? html`<a href="/admin/users/${row.targetId}">user</a>` : row.targetType}</td>
                  <td>${row.detail}</td>
                </tr>`,
              )}
            </tbody>
          </table>`
        : html`<p>Nothing yet.</p>`,
    ),
  );
});

admin.get("/crashes", async (c) => {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const rows = await getDb(c.env)
    .select({
      message: schema.clientErrors.message,
      count: sql<number>`count(*)`,
      latest: sql<number>`max(${schema.clientErrors.createdAt})`,
      appVersion: sql<string>`max(${schema.clientErrors.appVersion})`,
      platform: sql<string>`max(${schema.clientErrors.platform})`,
      stack: sql<string>`max(${schema.clientErrors.stack})`,
      fatal: sql<number>`max(${schema.clientErrors.fatal})`,
    })
    .from(schema.clientErrors)
    .where(gt(schema.clientErrors.createdAt, since))
    .groupBy(schema.clientErrors.message)
    .orderBy(desc(sql`max(${schema.clientErrors.createdAt})`))
    .limit(50);
  return c.html(
    page(
      "Crashes, last 30 days",
      rows.length
        ? rows.map(
            (row) => html`<article>
              <p><strong class="${row.fatal ? "urgent" : ""}">${row.message}</strong></p>
              <p class="muted">${plural(row.count, "time")}, latest ${new Date(row.latest).toUTCString()}, ${row.platform} ${row.appVersion}</p>
              <details><summary>Stack</summary><pre>${row.stack}</pre></details>
            </article>`,
          )
        : html`<p>None.</p>`,
    ),
  );
});

export default admin;
