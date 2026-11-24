import { emailSchema, outcomeSummary, type AppVersionInfo, versionCode, type OutcomeCounts, type TopicOutcomes } from "@babillard/shared";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { html, raw } from "hono/html";
import { getDb, schema } from "../db";
import { LEGAL_PATHS, LEGAL_TEXT, type Language, type LegalPage } from "../legal/content";
import { isDevMode } from "../lib/config";
import { buildIcs } from "../lib/ics";
import { localizeTopic, requestLanguage, venueNames } from "../lib/language";
import { flyer } from "../lib/flyer";
import { appLink, legalTabs, page } from "../lib/page";
import type { AppEnv } from "../types";

const ANDROID_APK_KEY = "releases/babillard.apk";

const CONTACT = "info@babillard.app";

const IPHONE_PATHS: Record<Language, string> = { en: "/iphone", fr: "/fr/iphone" };

function getApp(language: Language = "en") {
  return language === "fr"
    ? html`<p>${appLink("fr", "Obtenir l'application Android", "button")}</p><p class="muted">Vous avez un iPhone? <a href="${IPHONE_PATHS.fr}">Inscrivez-vous à la liste d'attente</a></p>`
    : html`<p>${appLink("en", "Get the Android app", "button")}</p><p class="muted">On an iPhone? <a href="${IPHONE_PATHS.en}">Join the waitlist</a></p>`;
}

/** How groups work, for someone who followed a link and hasn't seen the home page. */
function howItWorks(language: Language) {
  return language === "fr"
    ? html`<p class="lead">Sur Babillard, quand trois personnes d'une même ville choisissent le même sujet, une discussion de groupe s'ouvre et elles planifient une rencontre.</p>`
    : html`<p class="lead">On Babillard, when three people in a city pick the same topic, a group chat opens and they plan a time to meet.</p>`;
}

const homeLink = (language: Language) => (language === "fr" ? html`<p><a href="/fr/">Voir comment ça marche</a></p>` : html`<p><a href="/">See how it works</a></p>`);

type WaitlistState = "form" | "invalid" | "joined" | "limited";

/** The iPhone waitlist: one form, and the page it answers with. Every outcome renders the same frame. */
function waitlistPage(language: Language, state: WaitlistState, email = "") {
  const fr = language === "fr";
  const privacy = LEGAL_PATHS.privacy[language];
  const alternate = IPHONE_PATHS[fr ? "en" : "fr"];
  if (state === "joined") {
    const body = fr
      ? html`<h1>Vous êtes sur la liste</h1><p>Si Babillard arrive sur iPhone, nous vous écrirons une seule fois, puis nous supprimerons votre adresse.</p><p><a class="button" href="/fr/">Retour à l'accueil</a></p>`
      : html`<h1>You're on the list</h1><p>If Babillard comes to the iPhone, we'll email you once and then delete your address.</p><p><a class="button" href="/">Back to the home page</a></p>`;
    return page(fr ? "Inscription reçue" : "You're on the list", body, language, { hidden: true });
  }
  const error =
    state === "invalid"
      ? html`<p class="error" id="waitlist-error" role="alert">${fr ? "Cette adresse courriel ne semble pas valide." : "That doesn't look like an email address."}</p>`
      : state === "limited"
        ? html`<p class="error" id="waitlist-error" role="alert">${fr ? "Trop d'essais depuis ce réseau. Attendez une minute et réessayez." : "Too many tries from this network. Wait a minute and try again."}</p>`
        : "";
  const flagged = state === "form" ? "" : raw(' aria-invalid="true" aria-describedby="waitlist-error"');
  const form = html`<form class="form" method="post" action="/iphone">
    <input type="hidden" name="language" value="${language}" />
    <label>${fr ? "Courriel" : "Email"}<input type="email" name="email" value="${email}" required maxlength="254" autocomplete="email"${flagged} /></label>
    <label class="trap" aria-hidden="true">Website<input type="text" name="website" tabindex="-1" autocomplete="off" /></label>
    <button class="button" type="submit">${fr ? "M'inscrire" : "Join the waitlist"}</button>
    ${error}
  </form>`;
  const body = fr
    ? html`<h1>Babillard sur iPhone</h1>
        <p>Il n'y a pas encore d'application iPhone. Le nombre d'inscriptions nous aide à décider s'il faut en faire une. Laissez votre courriel et nous vous écrirons une seule fois, si elle sort.</p>
        ${form}
        <p class="muted">Nous ne gardons que votre adresse et votre langue, seulement pour ce courriel, et nous les supprimons ensuite, ou après deux ans au plus. Pour retirer votre adresse plus tôt, écrivez à <a href="mailto:${CONTACT}">${CONTACT}</a>. Voir la <a href="${privacy}">politique de confidentialité</a>.</p>`
    : html`<h1>Babillard for iPhone</h1>
        <p>There's no iPhone app yet. How many people sign up helps us decide whether to make one. Leave your email and we'll write once, if it comes out.</p>
        ${form}
        <p class="muted">We keep only your address and language, use them for that one email, and delete them afterwards, or after two years at most. To be removed sooner, write to <a href="mailto:${CONTACT}">${CONTACT}</a>. See the <a href="${privacy}">privacy policy</a>.</p>`;
  return page(fr ? "Babillard sur iPhone" : "Babillard for iPhone", body, language, {
    alternate,
    path: IPHONE_PATHS[language],
    description: fr ? "Inscrivez-vous à la liste d'attente de Babillard sur iPhone." : "Join the waitlist for Babillard on the iPhone.",
  });
}

/**
 * Unknown paths, missing topics, and cancelled or unknown meetup links. Browsers get a page in
 * the site's frame with a link home; everything else, like the app and calendar clients, gets
 * the plain 404 it always did.
 */
export function notFoundPage(c: Context<AppEnv>) {
  if (!c.req.header("accept")?.includes("text/html")) return c.text("404 Not Found", 404);
  const path = c.req.path;
  const language: Language = path === "/fr" || path.startsWith("/fr/") ? "fr" : requestLanguage(c);
  const body =
    language === "fr"
      ? html`<h1>Cette page n'existe pas</h1>
          <p>Le lien est peut-être mal tapé, ou ce qu'il désignait a été retiré. Le lien d'une rencontre cesse de fonctionner quand elle est annulée.</p>
          <p><a class="button" href="/fr/">Aller à l'accueil</a></p>`
      : html`<h1>This page isn't here</h1>
          <p>The link may be mistyped, or what it pointed to was removed. A meetup's link stops working once the meetup is cancelled.</p>
          <p><a class="button" href="/">Go to the home page</a></p>`;
  return c.html(page(language === "fr" ? "Page introuvable" : "Page not found", body, language, { hidden: true }), 404);
}

/** A count of a few people reads as discouraging and says little, so the topic page only shows it from here. */
const PICKED_MIN_SHOWN = 5;

/** How many people with an account have swiped right on a topic, in every city. */
async function pickedCount(db: ReturnType<typeof getDb>, topicId: string): Promise<number> {
  const swipes = schema.topicSwipes;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(swipes)
    .innerJoin(schema.users, eq(schema.users.id, swipes.userId))
    .where(and(eq(swipes.topicId, topicId), eq(swipes.direction, "right"), eq(schema.users.status, "active")));
  return row?.count ?? 0;
}

function pickedLine(count: number, language: Language) {
  if (count < PICKED_MIN_SHOWN) return "";
  return html`<p class="muted">${language === "fr" ? `${count} personnes ont choisi ce sujet sur Babillard jusqu'ici.` : `${count} people have picked this topic on Babillard so far.`}</p>`;
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

const LEGAL_DESCRIPTIONS: Record<LegalPage, Record<Language, string>> = {
  privacy: { en: "What Babillard collects, who sees it, and how long we keep it.", fr: "Ce que Babillard recueille, qui le voit et combien de temps nous le gardons." },
  terms: { en: "The rules for using Babillard.", fr: "Les règles d'utilisation de Babillard." },
  safety: { en: "How Babillard handles reports, harmful content, and meeting safely.", fr: "Comment Babillard traite les signalements, les contenus préjudiciables et la sécurité des rencontres." },
};

function legalPage(pageName: LegalPage, language: Language) {
  const other: Language = language === "en" ? "fr" : "en";
  const text = LEGAL_TEXT[pageName][language];
  const title = text.split("\n")[0]!.slice(2);
  return page(title, html`${legalTabs(pageName, language)}${raw(renderLegal(text))}`, language, { alternate: LEGAL_PATHS[pageName][other], path: LEGAL_PATHS[pageName][language], description: LEGAL_DESCRIPTIONS[pageName][language] });
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
          <li>${fr ? `${outcomes.agreed} % surtout d'accord, ${outcomes.split} % avis partagés, ${outcomes.disagreed} % surtout en désaccord` : `${outcomes.agreed}% mostly agreed, ${outcomes.split}% split, ${outcomes.disagreed}% mostly disagreed`}</li>
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
  // Installs compare Android build codes, which come from the version (0.2.0 is 200).
  const code = (version: string | undefined) => (version ? versionCode(version) : 1);
  const info: AppVersionInfo = {
    android: { latest: code(c.env.ANDROID_LATEST_VERSION), minimum: code(c.env.ANDROID_MIN_VERSION), url: `${c.env.PUBLIC_ORIGIN}/download/android` },
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
            // Comma-separated: the key EAS signs the website's APK with, and Google Play's own signing key.
            target: {
              namespace: "android_app",
              package_name: c.env.ANDROID_PACKAGE,
              sha256_cert_fingerprints: c.env.ANDROID_CERT_SHA256.split(",").map((print) => print.trim()).filter(Boolean),
            },
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

for (const language of ["en", "fr"] as const) {
  publicRoutes.get(IPHONE_PATHS[language], (c) => c.html(waitlistPage(language, "form")));
}

/**
 * A plain form post, so it works without JavaScript. The answer is the same whether or not the
 * address was already on the list, so the form can't tell anyone who signed up. Nothing is
 * emailed now: a confirmation would let anyone send mail to any address through this form.
 */
publicRoutes.post("/iphone", async (c) => {
  const form = await c.req.parseBody();
  const language: Language = form.language === "fr" ? "fr" : "en";
  // Only bots fill the hidden field. Tell them it worked and keep nothing.
  if (typeof form.website === "string" && form.website !== "") return c.html(waitlistPage(language, "joined"));
  const entered = typeof form.email === "string" ? form.email : "";
  const parsed = emailSchema.safeParse(entered);
  if (!parsed.success) return c.html(waitlistPage(language, "invalid", entered.slice(0, 254)), 400);
  if (!isDevMode(c.env)) {
    const { success } = await c.env.WAITLIST_LIMIT.limit({ key: c.req.header("cf-connecting-ip") ?? "unknown" });
    if (!success) return c.html(waitlistPage(language, "limited", parsed.data), 429);
  }
  await getDb(c.env).insert(schema.iphoneWaitlist).values({ email: parsed.data, language, createdAt: Date.now() }).onConflictDoNothing();
  return c.html(waitlistPage(language, "joined"));
});

publicRoutes.get("/invite", async (c) => {
  const language = requestLanguage(c);
  const fr = language === "fr";
  const starters = await getDb(c.env).select().from(schema.topics).where(and(isNotNull(schema.topics.starter), eq(schema.topics.status, "seeded"))).orderBy(schema.topics.starter).limit(4);
  const flyers = starters.map((topic, i) => flyer(localizeTopic(topic, language).title, "", { field: topic.fieldTags[0], question: topic.kind === "question", taken: [2, 5, 1, 3][i], decorative: true }));
  const title = fr ? "Quelqu'un veut parler d'idées avec vous" : "Someone wants to talk ideas with you";
  return c.html(
    page(
      title,
      html`<div class="poster">
        <div class="fan">${flyers}</div>
        <div><h1>${title}</h1>${howItWorks(language)}${getApp(language)}${homeLink(language)}</div>
      </div>`,
      language,
      { hidden: true, wide: true, description: fr ? "Choisissez un sujet et rencontrez les gens près de chez vous qui l'ont choisi aussi." : "Pick a topic and meet the people near you who picked it too." },
    ),
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
  const [{ outcomes, takeaways }, picked] = await Promise.all([topicOutcomes(db, topic.id), pickedCount(db, topic.id)]);
  return c.html(
    page(
      title,
      html`<div class="poster">
          ${flyer(title, blurb ? html`<p>${blurb}</p>` : "", { field: topic.fieldTags[0], question: topic.kind === "question" })}
          <div>${howItWorks(language)}${pickedLine(picked, language)}${getApp(language)}${homeLink(language)}</div>
        </div>
        ${outcomesSection(outcomes, takeaways, language)}`,
      language,
      { path: `/t/${topic.id}`, wide: true, description: blurb || undefined },
    ),
  );
});

/** Reachable only through an unguessable token. Shows the plan, never who's going. */
publicRoutes.get("/m/:file", async (c) => {
  const file = c.req.param("file");
  const wantsIcs = file.endsWith(".ics");
  const token = wantsIcs ? file.slice(0, -4) : file;
  const db = getDb(c.env);

  const [row] = await db
    .select({ meetup: schema.meetups, englishTitle: schema.topics.title, topicFr: schema.topics.fr, topicId: schema.topics.id, topicKind: schema.topics.kind, fieldTags: schema.topics.fieldTags, kind: schema.conversations.kind })
    .from(schema.meetups)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.meetups.conversationId))
    .leftJoin(schema.topics, eq(schema.topics.id, schema.conversations.topicId))
    .where(eq(schema.meetups.shareToken, token));
  if (!row || row.meetup.state === "cancelled") return c.notFound();

  const { meetup, englishTitle, topicFr, topicId, topicKind, fieldTags, kind } = row;
  const language = requestLanguage(c);
  const fr = language === "fr";
  // Topics people suggest have no French version, so they show as written.
  const topicTitle = fr && topicFr ? topicFr.title : englishTitle;
  // The page only invites people in when the group welcomed guests and the meetup hasn't happened yet.
  const welcomesGuests = kind === "group" && meetup.guestsWelcome && meetup.state !== "done" && meetup.startsAt > Date.now();
  const brand = fr ? "Rencontre Babillard" : "Babillard meetup";
  const summary = topicTitle ? `${brand}: ${topicTitle}` : brand;
  const location = venueNames(meetup)[language];
  const url = `${c.env.PUBLIC_ORIGIN}/m/${token}`;

  if (wantsIcs) {
    return new Response(buildIcs({ uid: meetup.id, startsAt: meetup.startsAt, endsAt: meetup.endsAt, summary, location, url }), {
      headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="meetup.ics"' },
    });
  }
  return c.html(
    page(
      summary,
      html`<div class="poster">
        ${flyer(topicTitle ?? (fr ? "Une rencontre" : "A meetup"), html`<p class="when"><time datetime="${new Date(meetup.startsAt).toISOString()}" data-local>${new Date(meetup.startsAt).toUTCString()}</time></p><p>${location}</p>`, { field: fieldTags?.[0], question: topicKind === "question" })}
        <div><p><a class="button" href="${url}.ics">${fr ? "Ajouter au calendrier" : "Add to calendar"}</a></p>
        ${welcomesGuests
          ? html`<p>${fr ? "Les personnes invitées sont les bienvenues. Venez en parler avec le groupe." : "Guests are welcome. Come and talk about it with the group."}</p>
              ${topicId ? html`<p><a href="/t/${topicId}">${fr ? "En savoir plus sur ce sujet" : "More about this topic"}</a></p>` : ""}
              <p>${fr ? "Pour trouver d'autres groupes près de chez vous, obtenez Babillard." : "To find more groups near you, get Babillard."}</p>
              ${getApp(language)}`
          : ""}</div></div>
        <script>
          // The server doesn't know the reader's time zone, but their browser does.
          for (const el of document.querySelectorAll("time[data-local]")) el.textContent = new Date(el.getAttribute("datetime")).toLocaleString(document.documentElement.lang, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
        </script>`,
      language,
      { hidden: true, wide: true },
    ),
  );
});

export default publicRoutes;
