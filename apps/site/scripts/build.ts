import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copy, type Lang } from "../src/copy.ts";

const ORIGIN = "https://babillard.app";
const DOWNLOAD = "/download/android";
const SEATS = 8;
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function tabs(taken: number, tearing = -1): string {
  return `<div class="tabs">${Array.from({ length: SEATS }, (_, i) => `<span class="tab${i < taken ? " taken" : ""}${i === tearing ? " tearing" : ""}"></span>`).join("")}</div>`;
}

function flyer(f: { fields: string; title: string; blurb?: string; bg: string; fg: string; question?: boolean }, extra = "", taken = 0): string {
  return `<div class="flyer${f.question ? " question" : ""}" style="--bg:${f.bg};--fg:${f.fg}">
  <div class="sheet"><p class="fields">${esc(f.fields)}</p><p class="ftitle">${esc(f.title)}</p>${f.blurb ? `<p class="blurb">${esc(f.blurb)}</p>` : ""}${extra}</div>
  ${tabs(taken)}
</div>`;
}

const icons = {
  topics: `<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/></svg>`,
  people: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>`,
  chats: `<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>`,
  you: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="10" r="3"/></svg>`,
  lock: `<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
  back: `<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>`,
  pin: `<svg viewBox="0 0 24 24"><path d="M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
};

function phone(lang: Lang): string {
  const p = copy[lang].phone;
  const tabBar = (active: string) =>
    `<nav class="tabbar">${(["topics", "people", "chats", "you"] as const).map((k) => `<span class="${k === active ? "on" : ""}">${icons[k]}</span>`).join("")}</nav>`;
  const chatHead = (title: string, sub: string, avatars: string[]) =>
    `<header class="chathead">${icons.back}<span class="avatars">${avatars.map((a, i) => `<span class="av av${i}">${esc(a[0]!)}</span>`).join("")}</span><span class="who"><b>${esc(title)}</b><small>${icons.lock}${esc(p.encrypted)} · ${esc(sub)}</small></span></header>`;
  const composer = `<div class="composer"><span>${esc(p.composer)}</span></div>`;
  const stances = `<div class="stances">${p.vote.stances.map((s, i) => `<span class="stance${i === 0 ? " pick" : ""}">${esc(s)}</span>`).join("")}</div>`;
  const vote = { fields: p.vote.fields, title: p.vote.title, bg: "#FF6A47", fg: "#15173D", question: true };
  const walk = { fields: p.walk.fields, title: p.walk.title, blurb: p.walk.blurb, bg: "#C93410", fg: "#FFFFFF" };

  return `<div class="phone" aria-hidden="true"><div class="screen">
  <div class="statusbar"><span>9:41</span><span class="dots"></span></div>
  <section class="scene scene-deck">
    <div class="chips">${p.chips.map((c, i) => `<span class="chip${i === 0 ? " on" : ""}">${esc(c)}</span>`).join("")}</div>
    <div class="stack">
      <div class="card under">${flyer(vote, stances + `<p class="nearby">${esc(p.vote.nearby)}</p>`, 3).replace('<span class="tab"></span>', '<span class="tab next"></span>')}</div>
      <div class="card top">${flyer(walk, `<p class="nearby">${esc(p.walk.nearby)}</p>`, 5)}</div>
    </div>
    <div class="controls"><span class="ctl skip">✕</span><span class="ctl like">✓</span></div>
    ${tabBar("topics")}
  </section>
  <section class="scene scene-group">
    ${chatHead(p.groupTitle, p.groupSub, ["Maya", "Jon", "Priya", "Y"])}
    <div class="log">
      <p class="sys">${esc(p.opened)}</p>
      ${p.group.map(([who, text], i) => (who === "me" ? `<div class="msg me" style="--i:${i}"><span>${esc(text)}</span></div>` : `<div class="msg them" style="--i:${i}"><small>${esc(who)}</small><span>${esc(text)}</span></div>`)).join("")}
    </div>
    ${composer}
  </section>
  <section class="scene scene-pair">
    ${chatHead(p.pairName, p.pairSub, ["Sam"])}
    <div class="log">
      <p class="sys opener">${esc(p.pairOpener)}</p>
      ${p.pair.map(([who, text], i) => `<div class="msg ${who}" style="--i:${i}"><span>${esc(text)}</span></div>`).join("")}
    </div>
    ${composer}
  </section>
  <section class="scene scene-meet">
    ${chatHead(p.groupTitle, p.groupSub, ["Maya", "Jon", "Priya", "Y"])}
    <div class="log">
      ${p.group.slice(-2).map(([who, text]) => (who === "me" ? `<div class="msg me"><span>${esc(text)}</span></div>` : `<div class="msg them"><small>${esc(who)}</small><span>${esc(text)}</span></div>`)).join("")}
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
  const download = (cls: string) => `<a class="${cls}" href="${DOWNLOAD}">${esc(c.download)}</a>`;
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
<meta property="og:title" content="${esc(c.title)}">
<meta property="og:description" content="${esc(c.description)}">
<meta property="og:image" content="${ORIGIN}/site/icon.png">
<meta property="og:url" content="${ORIGIN}${c.path}">
<meta name="theme-color" content="#EEF0F8">
<link rel="icon" href="/site/icon.png">
<link rel="preload" href="/site/fonts/bricolage-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site/site.css">
<script>document.documentElement.classList.add("js")</script>
<script src="/site/site.js" defer></script>
</head>
<body>
<a class="skip" href="#main">${esc(c.skip)}</a>
<header class="bar">
  <a class="brand" href="${c.path}"><img src="/site/icon.png" alt="" width="32" height="32">Babillard</a>
  <nav class="barnav"><a href="${c.otherPath}" hreflang="${c.otherLang}" lang="${c.otherLang}">${esc(c.otherLabel)}</a>${download("btn small")}</nav>
</header>
<main id="main">
  <section class="hero">
    <div class="hero-copy">
      <h1><span>${esc(c.hero.h1[0])}</span> <span>${esc(c.hero.h1[1])}</span></h1>
      <p class="cta">${download("btn")}<span class="note">${esc(c.hero.note)}</span></p>
    </div>
    <div class="board" aria-hidden="true">
      ${c.board.map((f, i) => `<div class="pinned p${i}" style="--n:${i}">${flyer(f, "", [2, 5, 1, 3, 6, 0, 4, 2, 3][i])}</div>`).join("\n      ")}
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

  <section class="end" aria-labelledby="end-title">
    <h2 id="end-title">${esc(c.end.h)}</h2>
    <p>${esc(c.end.p)}</p>
    ${download("btn invert")}
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
