import { VENUE_LABELS } from "@ideas-match/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { html } from "hono/html";
import { getDb, schema } from "../db";
import { buildIcs } from "../lib/ics";
import type { AppEnv } from "../types";

function page(title: string, body: unknown) {
  return html`<!doctype html>
    <html lang="en">
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
        <p class="muted">Ideas Match is where people find each other through what they want to talk about, then meet in person.</p>
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

publicRoutes.get("/avatars/:key", async (c) => {
  const object = await c.env.AVATARS.get(c.req.param("key"));
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
});

publicRoutes.get("/invite", (c) =>
  c.html(page("Join Ideas Match", html`<h1>Someone wants to talk ideas with you</h1><p>Swipe on the topics you care about, match with people nearby, and meet up.</p>`)),
);

publicRoutes.get("/t/:id", async (c) => {
  const db = getDb(c.env);
  const [topic] = await db
    .select()
    .from(schema.topics)
    .where(and(eq(schema.topics.id, c.req.param("id")), inArray(schema.topics.status, ["seeded", "approved"])));
  if (!topic) return c.notFound();
  return c.html(page(topic.title, html`<h1>${topic.title}</h1><p>${topic.blurb}</p><p><a class="button" href="ideasmatch://deck">Open in the app</a></p>`));
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
