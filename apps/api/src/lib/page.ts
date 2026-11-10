import { html, raw } from "hono/html";
import { LEGAL_PATHS, type Language, type LegalPage } from "../legal/content";

/**
 * The frame for every page the API serves to browsers: the policies, invites, and share
 * pages. It borrows the landing page's look (apps/site): the same fonts, colours, header,
 * and footer, so following a link from the app doesn't feel like leaving it.
 */

const LEGAL_NAMES: Record<LegalPage, Record<Language, string>> = {
  privacy: { en: "Privacy", fr: "Confidentialité" },
  terms: { en: "Terms", fr: "Conditions" },
  safety: { en: "Safety", fr: "Sécurité" },
};

const STYLE = `
@font-face { font-family: "Bricolage"; src: url("/site/fonts/bricolage-800.woff2") format("woff2"); font-weight: 800; font-display: swap; }
@font-face { font-family: "Bricolage"; src: url("/site/fonts/bricolage-600.woff2") format("woff2"); font-weight: 600; font-display: swap; }
@font-face { font-family: "Atkinson"; src: url("/site/fonts/atkinson-400.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "Atkinson"; src: url("/site/fonts/atkinson-700.woff2") format("woff2"); font-weight: 700; font-display: swap; }
:root { --paper: #EEF0F8; --surface: #FFFFFF; --ink: #15173D; --muted: #55597A; --line: #D5D8E8; --accent: #C7146F; --gutter: clamp(16px, 4vw, 40px); }
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.0625rem/1.65 "Atkinson", system-ui, sans-serif; display: flex; flex-direction: column; min-height: 100vh; }
a { color: inherit; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
.bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px var(--gutter); border-bottom: 1px solid var(--line); background: var(--paper); }
.brand { display: flex; align-items: center; gap: 10px; font: 800 1.2rem/1 "Bricolage", system-ui, sans-serif; text-decoration: none; }
.brand img { border-radius: 8px; }
.bar nav { display: flex; align-items: center; gap: 16px; font-weight: 700; font-size: 0.95rem; }
.bar nav a { text-decoration: none; }
.bar nav a:hover { text-decoration: underline; text-underline-offset: 4px; }
main { flex: 1; width: 100%; max-width: 44rem; margin: 0 auto; padding: clamp(32px, 6vw, 64px) var(--gutter) 72px; }
h1, h2, h3 { font-family: "Bricolage", system-ui, sans-serif; letter-spacing: -0.015em; text-wrap: balance; }
h1 { font-weight: 800; font-size: clamp(2.2rem, 7vw, 3.4rem); line-height: 1; margin: 0 0 16px; }
h2 { font-weight: 800; font-size: clamp(1.35rem, 3.6vw, 1.7rem); line-height: 1.15; margin: 44px 0 10px; }
h3 { font-weight: 600; font-size: 1.15rem; margin: 28px 0 6px; }
p, ul { margin: 0 0 16px; }
ul { padding-left: 1.3rem; }
li { margin: 6px 0; }
li::marker { color: var(--accent); }
strong { font-weight: 700; }
.meta, .muted { color: var(--muted); }
.meta { font-size: 0.95rem; margin-bottom: 8px; }
.tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 28px; padding: 0; list-style: none; }
.tabs a { display: inline-flex; align-items: center; min-height: 40px; padding: 0 16px; border: 2px solid var(--ink); border-radius: 999px; font-weight: 700; font-size: 0.95rem; text-decoration: none; }
.tabs a[aria-current="page"] { background: var(--ink); color: var(--paper); }
.button { display: inline-flex; align-items: center; min-height: 50px; padding: 0 22px; border-radius: 10px; background: var(--accent); color: #fff; font-weight: 700; text-decoration: none; }
.button:hover { background: #A80F5C; }
blockquote { margin: 0 0 14px; padding: 14px 18px; background: var(--surface); border-left: 4px solid var(--accent); border-radius: 0 10px 10px 0; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 20px 22px; margin: 0 0 20px; }
.foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px 24px; padding: 24px var(--gutter) 32px; background: var(--ink); color: var(--paper); font-size: 0.95rem; }
.foot ul { display: flex; flex-wrap: wrap; gap: 6px 22px; list-style: none; margin: 0; padding: 0; }
.foot li { margin: 0; }
.foot li::marker { content: none; }
.foot a { text-decoration: none; }
.foot a:hover { text-decoration: underline; text-underline-offset: 4px; }
.foot p { margin: 0; color: #A9ADCB; }
`;

export interface PageOptions {
  /** The same page in the other language, for the header's language link. */
  alternate?: string;
  /** Share pages carry an unguessable link and shouldn't appear in search results. */
  hidden?: boolean;
}

export function page(title: string, body: unknown, language: Language = "en", options: PageOptions = {}) {
  const fr = language === "fr";
  const other: Language = fr ? "en" : "fr";
  const home = fr ? "/fr/" : "/";
  const legal = (Object.keys(LEGAL_PATHS) as LegalPage[]).map((name) => html`<li><a href="${LEGAL_PATHS[name][language]}">${LEGAL_NAMES[name][language]}</a></li>`);
  return html`<!doctype html>
    <html lang="${fr ? "fr-CA" : "en-CA"}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        ${options.hidden ? html`<meta name="robots" content="noindex" />` : ""}
        <title>${title} · Babillard</title>
        <link rel="icon" href="/site/icon.png" />
        <link rel="preload" href="/site/fonts/bricolage-800.woff2" as="font" type="font/woff2" crossorigin />
        <style>${raw(STYLE)}</style>
      </head>
      <body>
        <header class="bar">
          <a class="brand" href="${home}"><img src="/site/icon.png" alt="" width="32" height="32" />Babillard</a>
          <nav>${options.alternate ? html`<a href="${options.alternate}" hreflang="${other}" lang="${other}">${fr ? "English" : "Français"}</a>` : ""}<a href="/download/android">${fr ? "Télécharger" : "Download"}</a></nav>
        </header>
        <main>${body}</main>
        <footer class="foot">
          <ul>${legal}</ul>
          <p>${fr ? "Rencontrez les gens qui veulent parler des mêmes idées." : "Meet the people who want to talk about the same ideas."}</p>
        </footer>
      </body>
    </html>`;
}

export function legalTabs(current: LegalPage, language: Language) {
  return html`<ul class="tabs">${(Object.keys(LEGAL_PATHS) as LegalPage[]).map(
    (name) => html`<li><a href="${LEGAL_PATHS[name][language]}" ${name === current ? html`aria-current="page"` : ""}>${LEGAL_NAMES[name][language]}</a></li>`,
  )}</ul>`;
}
