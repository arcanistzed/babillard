import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copy, type Lang } from "../src/copy.ts";

const ORIGIN = "https://babillard.app";
const DOWNLOAD = "/download/android";
const SEATS = 8;
/** A QR code for https://babillard.app/download/android: modules as a path, from `qrcode` at error level M. */
const QR = { size: 29, path: "M0 0h7v1h-7zM10 0h1v1h-1zM12 0h2v1h-2zM16 0h1v1h-1zM18 0h3v1h-3zM22 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM9 1h1v1h-1zM11 1h1v1h-1zM15 1h2v1h-2zM20 1h1v1h-1zM22 1h1v1h-1zM28 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM8 2h2v1h-2zM14 2h1v1h-1zM16 2h1v1h-1zM18 2h3v1h-3zM22 2h1v1h-1zM24 2h3v1h-3zM28 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM8 3h2v1h-2zM12 3h3v1h-3zM17 3h1v1h-1zM19 3h1v1h-1zM22 3h1v1h-1zM24 3h3v1h-3zM28 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM8 4h2v1h-2zM11 4h1v1h-1zM16 4h4v1h-4zM22 4h1v1h-1zM24 4h3v1h-3zM28 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM8 5h2v1h-2zM11 5h2v1h-2zM14 5h2v1h-2zM17 5h1v1h-1zM22 5h1v1h-1zM28 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h1v1h-1zM20 6h1v1h-1zM22 6h7v1h-7zM8 7h1v1h-1zM0 8h1v1h-1zM2 8h5v1h-5zM15 8h3v1h-3zM20 8h1v1h-1zM22 8h5v1h-5zM0 9h1v1h-1zM2 9h3v1h-3zM7 9h2v1h-2zM10 9h4v1h-4zM16 9h1v1h-1zM19 9h6v1h-6zM28 9h1v1h-1zM2 10h1v1h-1zM4 10h1v1h-1zM6 10h1v1h-1zM8 10h2v1h-2zM11 10h1v1h-1zM13 10h3v1h-3zM17 10h1v1h-1zM22 10h3v1h-3zM0 11h3v1h-3zM4 11h1v1h-1zM8 11h1v1h-1zM10 11h1v1h-1zM13 11h1v1h-1zM15 11h2v1h-2zM21 11h1v1h-1zM25 11h1v1h-1zM27 11h1v1h-1zM2 12h2v1h-2zM6 12h3v1h-3zM12 12h1v1h-1zM14 12h2v1h-2zM17 12h1v1h-1zM20 12h1v1h-1zM25 12h2v1h-2zM0 13h5v1h-5zM8 13h2v1h-2zM12 13h1v1h-1zM16 13h9v1h-9zM28 13h1v1h-1zM2 14h1v1h-1zM4 14h1v1h-1zM6 14h1v1h-1zM8 14h4v1h-4zM15 14h1v1h-1zM17 14h1v1h-1zM20 14h1v1h-1zM22 14h1v1h-1zM25 14h2v1h-2zM1 15h1v1h-1zM5 15h1v1h-1zM7 15h2v1h-2zM10 15h3v1h-3zM14 15h1v1h-1zM16 15h1v1h-1zM18 15h1v1h-1zM21 15h1v1h-1zM24 15h1v1h-1zM27 15h1v1h-1zM0 16h3v1h-3zM4 16h3v1h-3zM9 16h1v1h-1zM11 16h2v1h-2zM17 16h1v1h-1zM25 16h2v1h-2zM0 17h1v1h-1zM5 17h1v1h-1zM8 17h2v1h-2zM11 17h4v1h-4zM16 17h9v1h-9zM26 17h1v1h-1zM28 17h1v1h-1zM0 18h1v1h-1zM2 18h1v1h-1zM4 18h4v1h-4zM9 18h2v1h-2zM13 18h4v1h-4zM21 18h1v1h-1zM23 18h2v1h-2zM26 18h1v1h-1zM0 19h1v1h-1zM2 19h3v1h-3zM7 19h2v1h-2zM11 19h3v1h-3zM15 19h1v1h-1zM18 19h3v1h-3zM24 19h1v1h-1zM27 19h1v1h-1zM0 20h1v1h-1zM4 20h3v1h-3zM10 20h1v1h-1zM12 20h1v1h-1zM14 20h2v1h-2zM17 20h1v1h-1zM19 20h6v1h-6zM26 20h3v1h-3zM8 21h1v1h-1zM10 21h2v1h-2zM16 21h3v1h-3zM20 21h1v1h-1zM24 21h5v1h-5zM0 22h7v1h-7zM12 22h1v1h-1zM15 22h3v1h-3zM19 22h2v1h-2zM22 22h1v1h-1zM24 22h3v1h-3zM0 23h1v1h-1zM6 23h1v1h-1zM8 23h4v1h-4zM14 23h1v1h-1zM16 23h1v1h-1zM20 23h1v1h-1zM24 23h1v1h-1zM27 23h2v1h-2zM0 24h1v1h-1zM2 24h3v1h-3zM6 24h1v1h-1zM8 24h2v1h-2zM11 24h1v1h-1zM17 24h1v1h-1zM20 24h5v1h-5zM26 24h1v1h-1zM0 25h1v1h-1zM2 25h3v1h-3zM6 25h1v1h-1zM8 25h2v1h-2zM13 25h2v1h-2zM18 25h1v1h-1zM25 25h4v1h-4zM0 26h1v1h-1zM2 26h3v1h-3zM6 26h1v1h-1zM8 26h2v1h-2zM11 26h1v1h-1zM13 26h3v1h-3zM18 26h2v1h-2zM22 26h6v1h-6zM0 27h1v1h-1zM6 27h1v1h-1zM12 27h2v1h-2zM15 27h2v1h-2zM20 27h2v1h-2zM25 27h1v1h-1zM27 27h1v1h-1zM0 28h7v1h-7zM8 28h3v1h-3zM12 28h1v1h-1zM15 28h1v1h-1zM17 28h1v1h-1zM19 28h1v1h-1zM21 28h2v1h-2zM24 28h1v1h-1zM26 28h1v1h-1z" };
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function tabs(taken: number, tearing = -1): string {
  return `<div class="tabs">${Array.from({ length: SEATS }, (_, i) => `<span class="tab${i < taken ? " taken" : ""}${i === tearing ? " tearing" : ""}"></span>`).join("")}</div>`;
}

function flyer(f: { fields?: string; title: string; blurb?: string; bg: string; fg: string; question?: boolean }, extra = "", taken = 0): string {
  // Like the app, long titles print smaller so they fit the sheet.
  return `<div class="flyer${f.question ? " question" : ""}${f.title.length > 48 ? " long" : ""}" style="--bg:${f.bg};--fg:${f.fg}">
  <div class="sheet">${f.fields ? `<p class="fields">${esc(f.fields)}</p>` : ""}<p class="ftitle">${esc(f.title)}</p>${f.blurb ? `<p class="blurb">${esc(f.blurb)}</p>` : ""}${extra}</div>
  ${tabs(taken)}
</div>`;
}

const icons = {
  topics: `<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/></svg>`,
  people: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>`,
  chats: `<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>`,
  you: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="10" r="3"/></svg>`,
  back: `<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>`,
  info: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.1"/></svg>`,
  down: `<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 2v4M16 2v4"/></svg>`,
  pin: `<svg viewBox="0 0 24 24"><path d="M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
};

function phone(lang: Lang): string {
  const p = copy[lang].phone;
  const tabBar = (active: string) =>
    `<nav class="tabbar">${(["topics", "people", "chats", "you"] as const).map((k, i) => `<span class="${k === active ? "on" : ""}">${icons[k]}<small>${esc(p.tabs[i]!)}</small></span>`).join("")}</nav>`;
  const chatHead = (title: string) => `<header class="chathead">${icons.back}<b>${esc(title)}</b>${icons.info}</header>`;
  const message = (who: string, text: string, i?: number) =>
    `<div class="msg ${who === "me" ? "me" : "them"}"${i === undefined ? "" : ` style="--i:${i}"`}><span>${who === "me" || who === "them" ? "" : `<b>${esc(who)}</b>`}${esc(text)}</span></div>`;
  const composer = `<div class="composer"><b>${icons.calendar}${esc(p.meetUp)}</b><span>${esc(p.composer)}</span></div>`;
  const stances = `<div class="stances">${p.vote.stances.map((s, i) => `<span class="stance${i === 0 ? " pick" : ""}">${esc(s)}</span>`).join("")}</div>`;
  const vote = { fields: p.vote.fields, title: p.vote.title, bg: "#FF6A47", fg: "#15173D", question: true };
  const walk = { fields: p.walk.fields, title: p.walk.title, blurb: p.walk.blurb, bg: "#C93410", fg: "#FFFFFF" };

  return `<div class="phone" aria-hidden="true"><div class="screen">
  <div class="statusbar"><span>9:41</span><span class="dots"></span></div>
  <section class="scene scene-deck">
    <div class="deckhead"><b>${esc(p.title)}</b><span>${esc(p.filter)}${icons.down}</span></div>
    <div class="stack">
      <div class="card under">${flyer(vote, stances + `<p class="nearby">${esc(p.vote.nearby)}</p>`, 2).replace('<span class="tab"></span>', '<span class="tab next"></span>')}</div>
      <div class="card top">${flyer(walk, `<p class="nearby">${esc(p.walk.nearby)}</p>`, 5)}</div>
    </div>
    <div class="controls"><span class="ctl pass">${esc(p.skip)}</span><span class="ctl like">${esc(p.like)}</span></div>
    ${tabBar("topics")}
  </section>
  <section class="scene scene-group">
    ${chatHead(p.groupTitle)}
    <div class="log">
      <p class="sys">${esc(p.opened)}</p>
      ${p.group.map(([who, text], i) => message(who, text, i)).join("")}
    </div>
    ${composer}
  </section>
  <section class="scene scene-pair">
    ${chatHead(p.pairName)}
    <div class="log">
      <p class="sys opener">${esc(p.pairOpener)}</p>
      ${p.pair.map(([who, text], i) => message(who, text, i)).join("")}
    </div>
    ${composer}
  </section>
  <section class="scene scene-meet">
    ${chatHead(p.groupTitle)}
    <div class="log">
      ${p.group.slice(-2).map(([who, text]) => message(who, text)).join("")}
      <p class="sys">${esc(p.meetLine)}</p>
      <div class="meetup" style="--i:1">
        <b class="when">${esc(p.meetWhen)}</b>
        <span class="where">${icons.pin}${esc(p.meetWhere)}</span>
        <span class="state"><span class="pending">${esc(p.meetPending)}</span><span class="on">${esc(p.meetOn)}</span></span>
        <span class="rsvp">${p.meetChips.map((c, i) => `<span class="chip${i === 0 ? " pick" : ""}">${esc(c)}</span>`).join("")}</span>
      </div>
    </div>
    ${composer}
  </section>
</div></div>`;
}

function page(lang: Lang): string {
  const c = copy[lang];
  const download = (cls: string, label: string = c.download) => `<a class="${cls}" href="${DOWNLOAD}">${esc(label)}</a>`;
  // The file only installs on a phone, so on a computer these go to the QR code instead.
  const getApp = (cls: string) => `<a class="${cls} on-desktop" href="#get">${esc(c.getApp)}</a>`;
  const iphone = `<p class="iphone">${esc(c.iphone[0])} <a href="${lang === "fr" ? "/fr/iphone" : "/iphone"}">${esc(c.iphone[1])}</a></p>`;
  return `<!doctype html>
<html lang="${c.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.title)}</title>
<meta name="description" content="${esc(c.description)}">
<link rel="canonical" href="${ORIGIN}${c.path}">
<link rel="alternate" hreflang="${c.htmlLang}" href="${ORIGIN}${c.path}">
<link rel="alternate" hreflang="${c.otherLang}" href="${ORIGIN}${c.otherPath}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Babillard">
<meta property="og:locale" content="${c.htmlLang.replace("-", "_")}">
<meta property="og:title" content="${esc(c.title)}">
<meta property="og:description" content="${esc(c.description)}">
<meta property="og:image" content="${ORIGIN}${c.shareImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(c.shareAlt)}">
<meta property="og:url" content="${ORIGIN}${c.path}">
<meta name="twitter:card" content="summary_large_image">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#EEF0F8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#13142E" media="(prefers-color-scheme: dark)">
<link rel="alternate" hreflang="x-default" href="${ORIGIN}/">
<link rel="icon" href="/site/icon.png">
<link rel="apple-touch-icon" href="/site/icon.png">
<link rel="preload" href="/site/fonts/bricolage-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site/site.css">
<script>document.documentElement.classList.add("js")</script>
<script src="/site/site.js" defer></script>
</head>
<body>
<a class="skip" href="#main">${esc(c.skip)}</a>
<header class="bar">
  <a class="brand" href="${c.path}"><img src="/site/icon.png" alt="" width="32" height="32">Babillard</a>
  <nav class="barnav"><a href="${c.otherPath}" hreflang="${c.otherLang}" lang="${c.otherLang}">${esc(c.otherLabel)}</a>${download("btn small on-phone", c.downloadShort)}${getApp("btn small")}</nav>
</header>
<main id="main">
  <section class="hero">
    <div class="hero-copy">
      <h1><span>${esc(c.hero.h1[0])}</span> <span>${esc(c.hero.h1[1])}</span></h1>
      <p class="lede">${esc(c.hero.lede)}</p>
      <p class="cta">${download("btn on-phone")}${getApp("btn")}</p>
      ${iphone}
    </div>
    <div class="board" aria-hidden="true">
      ${[0, 1, 2].map((col) => `<div class="col">${c.board.map((f, i) => (i % 3 === col ? `<div class="pinned p${i}" style="--n:${i}">${flyer({ ...f, fields: undefined }, "", [2, 5, 1, 3, 6, 0, 4, 2, 3][i])}</div>` : "")).join("")}</div>`).join("\n      ")}
    </div>
  </section>

  <section class="story" aria-label="${esc(c.storyLabel)}" data-scene="deck">
    <div class="stage">${phone(lang)}</div>
    <ol class="steps">
      ${c.steps.map((s, i) => `<li class="step" data-step="${i}"><div class="steptext"><h2>${esc(s.h)}</h2><p>${esc(s.p)}</p></div></li>`).join("\n      ")}
    </ol>
  </section>

  <section class="rules" aria-labelledby="rules-title">
    <h2 id="rules-title">${esc(c.rulesTitle)}</h2>
    <ul>
      ${c.rules.map((r) => `<li style="--tab:${r.ink}"><h3>${esc(r.h)}</h3><p>${esc(r.p)}</p></li>`).join("\n      ")}
    </ul>
  </section>

  <section class="end" id="get" aria-labelledby="end-title">
    <div class="endcopy">
      <h2 id="end-title">${esc(c.end.h)}</h2>
      <ol class="install">${c.end.install.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>
      ${download("btn invert")}
      ${iphone}
      <p class="cities">${esc(c.end.cities)}</p>
    </div>
    <div class="qr on-desktop">
      <svg viewBox="0 0 ${QR.size} ${QR.size}" role="img" aria-label="${esc(c.end.scan)}" shape-rendering="crispEdges"><path d="${QR.path}"/></svg>
      <p aria-hidden="true">${esc(c.end.scan)}</p>
      ${tabs(3)}
    </div>
  </section>
  <div class="endtabs" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<span${[1, 4, 5, 9].includes(i) ? ' class="taken"' : ""}></span>`).join("")}</div>
</main>
<footer class="foot">
  <ul>${c.footer.map(([label, href]) => `<li><a href="${href}">${esc(label)}</a></li>`).join("")}<li><a href="${c.otherPath}" hreflang="${c.otherLang}" lang="${c.otherLang}">${esc(c.otherLabel)}</a></li></ul>
  <p>Babillard</p>
</footer>
</body>
</html>
`;
}

for (const lang of ["en", "fr"] as const) {
  const file = join(root, copy[lang].path, "index.html");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, page(lang));
  console.log(`wrote ${file}`);
}
