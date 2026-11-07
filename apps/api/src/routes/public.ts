import { VENUE_LABELS } from "@ideas-match/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { html, raw } from "hono/html";
import { getDb, schema } from "../db";
import { LEGAL_PATHS, LEGAL_TEXT, type Language, type LegalPage } from "../legal/content";
import { buildIcs } from "../lib/ics";
import type { AppEnv } from "../types";

const ANDROID_APK_KEY = "releases/ideas-match.apk";

function getApp() {
  return html`<p><a class="button" href="/download/android">Get the Android app</a></p><p class="muted">iPhone is coming soon.</p>`;
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
      return `<p>${inline(block)}</p>`;
    })
    .join("\n");
}

function legalPage(pageName: LegalPage, language: Language) {
  const other: Language = language === "en" ? "fr" : "en";
  const text = LEGAL_TEXT[pageName][language];
  const title = text.split("\n")[0]!.slice(2);
  const links = (Object.keys(LEGAL_PATHS) as LegalPage[]).map((name) => {
    const heading = LEGAL_TEXT[name][language].split("\n")[0]!.slice(2);
    return `<a href="${LEGAL_PATHS[name][language]}">${escapeHtml(heading)}</a>`;
  });
  const switcher = `<a href="${LEGAL_PATHS[pageName][other]}" lang="${other}">${other === "fr" ? "Français" : "English"}</a>`;
  return page(title, html`<p>${raw(switcher)}</p>${raw(renderLegal(text))}<p class="muted">${raw(links.join(" · "))}</p>`, language);
}

function page(title: string, body: unknown, language: Language = "en") {
  return html`<!doctype html>
    <html lang="${language}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>${title}</title>
        <style>
          :root { color-scheme: light dark; --ink: #1f2430; --paper: #fbf8f2; --muted: #5f6675; --accent: #b4432d; }
          @media (prefers-color-scheme: dark) { :root { --ink: #f2efe8; --paper: #17181c; --muted: #a2a7b3; --accent: #e8795f; } }
          body { font: 17px/1.55 Georgia, serif; background: var(--paper); color: var(--ink); max-width: 30rem; margin: 0 auto; padding: 3rem 1rem; }
          h1 { line-height: 1.2; }
          p.muted { color: var(--muted); }
          a.button { display: inline-block; font-family: system-ui, sans-serif; padding: 0.7rem 1.2rem; border-radius: 0.5rem; background: var(--accent); color: #fff; text-decoration: none; }
        </style>
      </head>
      <body>
        ${body}
        <p class="muted">${language === "fr" ? "Ideas Match aide les gens à se trouver grâce à ce dont ils veulent parler, puis à se rencontrer en personne." : "Ideas Match is where people find each other through what they want to talk about, then meet in person."}</p>
      </body>
    </html>`;
}

const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/healthz", (c) => c.json({ ok: true }));

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
    headers: { "content-type": "application/vnd.android.package-archive", "content-disposition": 'attachment; filename="ideas-match.apk"', "content-length": String(apk.size) },
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

publicRoutes.get("/invite", (c) =>
  c.html(page("Join Ideas Match", html`<h1>Someone wants to talk ideas with you</h1><p>Swipe on the topics you care about, match with people nearby, and meet up.</p>${getApp()}`)),
);

publicRoutes.get("/t/:id", async (c) => {
  const db = getDb(c.env);
  const [topic] = await db
    .select()
    .from(schema.topics)
    .where(and(eq(schema.topics.id, c.req.param("id")), inArray(schema.topics.status, ["seeded", "approved"])));
  if (!topic) return c.notFound();
  return c.html(page(topic.title, html`<h1>${topic.title}</h1><p>${topic.blurb}</p>${getApp()}`));
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
  const summary = topicTitle ? `Ideas Match meetup: ${topicTitle}` : "Ideas Match meetup";
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
        <p>${new Date(meetup.startsAt).toUTCString()}</p>
        <p><a class="button" href="${url}.ics">Add to calendar</a></p>`,
    ),
  );
});

export default publicRoutes;
