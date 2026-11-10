import { outcomeSummary, VENUE_LABELS, type AppVersionInfo, type OutcomeCounts, type TopicOutcomes } from "@babillard/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { html, raw } from "hono/html";
import { getDb, schema } from "../db";
import { LEGAL_PATHS, LEGAL_TEXT, type Language, type LegalPage } from "../legal/content";
import { buildIcs } from "../lib/ics";
import { localizeTopic, requestLanguage } from "../lib/language";
import { legalTabs, page } from "../lib/page";
import type { AppEnv } from "../types";

const ANDROID_APK_KEY = "releases/babillard.apk";

function getApp(language: Language = "en") {
  return language === "fr"
    ? html`<p><a class="button" href="/download/android">Obtenir l'application Android</a></p><p class="muted">Bientôt sur iPhone.</p>`
    : html`<p><a class="button" href="/download/android">Get the Android app</a></p><p class="muted">iPhone is coming soon.</p>`;
}

const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** The small part of Markdown the legal text uses: headings, bullets, bold, and paragraphs. */
function renderLegal(text: string): string {
  const inline = (line: string) => escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return text
    .split("\n\n")
    .map((block) => {
      if (block.startsWith("# ")) return `<h1>${inline(block.slice(2))}</h1>`;
      if (block.startsWith("## ")) return `<h2>${inline(block.slice(3))}</h2>`;
      if (block.startsWith("- ")) return `<ul>${block.split("\n").map((item) => `<li>${inline(item.slice(2))}</li>`).join("")}</ul>`;
      if (/^(Last updated|Dernière mise à jour):/.test(block)) return `<p class="meta">${inline(block)}</p>`;
      return `<p>${inline(block)}</p>`;
    })
    .join("\n");
}

function legalPage(pageName: LegalPage, language: Language) {
  const other: Language = language === "en" ? "fr" : "en";
  const text = LEGAL_TEXT[pageName][language];
  const title = text.split("\n")[0]!.slice(2);
  return page(title, html`${legalTabs(pageName, language)}${raw(renderLegal(text))}`, language, { alternate: LEGAL_PATHS[pageName][other] });
}

const MAX_TAKEAWAYS_SHOWN = 10;

/** Answers only count from people who still say the meetup happened. */
async function topicOutcomes(db: ReturnType<typeof getDb>, topicId: string) {
  const t = schema.meetupOutcomes;
  const metOnTopic = and(eq(schema.conversations.topicId, topicId), eq(schema.meetupResponses.didMeet, true));
  const [rows, takeaways] = await Promise.all([
    db
      .select({ mindChanged: t.mindChanged, endedUp: t.endedUp, meetAgain: t.meetAgain, count: sql<number>`count(*)` })
      .from(t)
      .innerJoin(schema.meetups, eq(schema.meetups.id, t.meetupId))
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.meetups.conversationId))
      .innerJoin(schema.meetupResponses, and(eq(schema.meetupResponses.meetupId, t.meetupId), eq(schema.meetupResponses.userId, t.userId)))
      .where(metOnTopic)
      .groupBy(t.mindChanged, t.endedUp, t.meetAgain),
    db
      .select({ text: t.takeaway, language: t.language })
      .from(t)
      .innerJoin(schema.meetups, eq(schema.meetups.id, t.meetupId))
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.meetups.conversationId))
      .innerJoin(schema.meetupResponses, and(eq(schema.meetupResponses.meetupId, t.meetupId), eq(schema.meetupResponses.userId, t.userId)))
      .where(and(metOnTopic, eq(t.takeawayStatus, "approved")))
      .orderBy(desc(t.reviewedAt))
      .limit(MAX_TAKEAWAYS_SHOWN),
  ]);
  const counts: OutcomeCounts = { mindChanged: {}, endedUp: {}, meetAgain: {} };
  for (const row of rows) {
    counts.mindChanged[row.mindChanged] = (counts.mindChanged[row.mindChanged] ?? 0) + row.count;
    counts.endedUp[row.endedUp] = (counts.endedUp[row.endedUp] ?? 0) + row.count;
    counts.meetAgain[row.meetAgain] = (counts.meetAgain[row.meetAgain] ?? 0) + row.count;
  }
  return { outcomes: outcomeSummary(counts), takeaways: takeaways.filter((row): row is { text: string; language: Language } => Boolean(row.text)) };
}

function outcomesSection(outcomes: TopicOutcomes | null, takeaways: { text: string; language: Language }[], language: Language) {
  if (!outcomes && takeaways.length === 0) return "";
  const fr = language === "fr";
  return html`<section>
    <h2>${fr ? "Après les rencontres" : "After meeting up"}</h2>
    ${outcomes
      ? html`<ul>
          <li>${fr ? `${outcomes.mindChanged} % ont vu quelqu'un changer d'avis` : `${outcomes.mindChanged}% saw someone change their mind`}</li>
          <li>${fr ? `${outcomes.agreed} % surtout d'accord, ${outcomes.split} % partagés, ${outcomes.disagreed} % surtout en désaccord` : `${outcomes.agreed}% mostly agreed, ${outcomes.split}% split, ${outcomes.disagreed}% mostly disagreed`}</li>
          <li>${fr ? `${outcomes.meetAgain} % se reverraient pour en parler` : `${outcomes.meetAgain}% would meet again on this`}</li>
        </ul>
        <p class="muted">${fr ? `D'après ${outcomes.answers} réponses.` : `From ${outcomes.answers} answers.`}</p>`
      : ""}
    ${takeaways.map((row) => html`<blockquote lang="${row.language}">${row.text}</blockquote>`)}
  </section>`;
}

const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/healthz", (c) => c.json({ ok: true }));

/** Open to everyone, since an outdated build may not be able to sign in. */
publicRoutes.get("/app/version", (c) => {
  const number = (value: string | undefined) => Math.max(Number.parseInt(value ?? "", 10) || 1, 1);
  const info: AppVersionInfo = {
    android: { latest: number(c.env.ANDROID_LATEST_BUILD), minimum: number(c.env.ANDROID_MIN_BUILD), url: `${c.env.PUBLIC_ORIGIN}/download/android` },
  };
  return c.json(info, 200, { "cache-control": "public, max-age=300" });
});

publicRoutes.get("/.well-known/apple-app-site-association", (c) =>
  c.json({ applinks: { details: [{ appIDs: c.env.APPLE_APP_ID ? [c.env.APPLE_APP_ID] : [], components: [{ "/": "/auth/link" }] }] } }),
);

publicRoutes.get("/.well-known/assetlinks.json", (c) =>
  c.json(
    c.env.ANDROID_CERT_SHA256
      ? [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: { namespace: "android_app", package_name: c.env.ANDROID_PACKAGE, sha256_cert_fingerprints: [c.env.ANDROID_CERT_SHA256] },
          },
        ]
      : [],
  ),
);

// Served from R2 because EAS removes its own copy of a build after about two weeks, and invite links need to keep working.
publicRoutes.get("/download/android", async (c) => {
  const apk = await c.env.AVATARS.get(ANDROID_APK_KEY);
  if (!apk) return c.notFound();
  return new Response(apk.body, {
    headers: { "content-type": "application/vnd.android.package-archive", "content-disposition": 'attachment; filename="babillard.apk"', "content-length": String(apk.size) },
  });
});

publicRoutes.get("/avatars/:key", async (c) => {
  const object = await c.env.AVATARS.get(c.req.param("key"));
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
});

for (const pageName of Object.keys(LEGAL_PATHS) as LegalPage[]) {
  for (const language of ["en", "fr"] as const) {
    publicRoutes.get(LEGAL_PATHS[pageName][language], (c) => c.html(legalPage(pageName, language)));
  }
}

publicRoutes.get("/invite", (c) => {
  const language = requestLanguage(c);
  return c.html(
    language === "fr"
      ? page("Rejoindre Babillard", html`<h1>Quelqu'un veut parler d'idées avec vous</h1><p>Faites glisser les sujets qui vous intéressent, trouvez des gens près de chez vous et rencontrez-les.</p>${getApp("fr")}`, "fr", { hidden: true })
      : page("Join Babillard", html`<h1>Someone wants to talk ideas with you</h1><p>Swipe on the topics you care about, match with people nearby, and meet up.</p>${getApp()}`, "en", { hidden: true }),
  );
});

publicRoutes.get("/t/:id", async (c) => {
  const db = getDb(c.env);
  const [topic] = await db
    .select()
    .from(schema.topics)
    .where(and(eq(schema.topics.id, c.req.param("id")), inArray(schema.topics.status, ["seeded", "approved"])));
  if (!topic) return c.notFound();
  const language = requestLanguage(c);
  const { title, blurb } = localizeTopic(topic, language);
  const { outcomes, takeaways } = await topicOutcomes(db, topic.id);
  return c.html(page(title, html`<h1>${title}</h1><p>${blurb}</p>${outcomesSection(outcomes, takeaways, language)}${getApp(language)}`, language));
});

/** Reachable only through an unguessable token. Shows the plan, never who's going. */
publicRoutes.get("/m/:file", async (c) => {
  const file = c.req.param("file");
  const wantsIcs = file.endsWith(".ics");
  const token = wantsIcs ? file.slice(0, -4) : file;
  const db = getDb(c.env);

  const [row] = await db
    .select({ meetup: schema.meetups, topicTitle: schema.topics.title })
    .from(schema.meetups)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.meetups.conversationId))
    .leftJoin(schema.topics, eq(schema.topics.id, schema.conversations.topicId))
    .where(eq(schema.meetups.shareToken, token));
  if (!row || row.meetup.state === "cancelled") return c.notFound();

  const { meetup, topicTitle } = row;
  const summary = topicTitle ? `Babillard meetup: ${topicTitle}` : "Babillard meetup";
  const location = meetup.venueNote || VENUE_LABELS[meetup.venueKind];
  const url = `${c.env.PUBLIC_ORIGIN}/m/${token}`;

  if (wantsIcs) {
    return new Response(buildIcs({ uid: meetup.id, startsAt: meetup.startsAt, endsAt: meetup.endsAt, summary, location, url }), {
      headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="meetup.ics"' },
    });
  }
  return c.html(
    page(
      summary,
      html`<h1>${topicTitle ?? "A meetup"}</h1>
        <p><strong>${location}</strong></p>
        <p><time datetime="${new Date(meetup.startsAt).toISOString()}" data-local>${new Date(meetup.startsAt).toUTCString()}</time></p>
        <p><a class="button" href="${url}.ics">Add to calendar</a></p>
        <script>
          // The server doesn't know the reader's time zone, but their browser does.
          for (const el of document.querySelectorAll("time[data-local]")) el.textContent = new Date(el.getAttribute("datetime")).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
        </script>`,
      "en",
      { hidden: true },
    ),
  );
});

export default publicRoutes;
