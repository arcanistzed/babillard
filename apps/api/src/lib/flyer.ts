import { html } from "hono/html";

const DARK_INK = "#15173D";
const WHITE = "#FFFFFF";

/** The app's flyer inks, one per field. Keep in step with FLYER_INKS in apps/mobile/src/theme.ts. */
const INKS: Record<string, [bg: string, fg: string]> = {
  economics: ["#FFC21A", DARK_INK],
  politics: ["#FF6A47", DARK_INK],
  law: ["#2B46D6", WHITE],
  history: ["#00727A", WHITE],
  philosophy: ["#6B3FC9", WHITE],
  sociology: ["#FF5FAE", DARK_INK],
  psychology: ["#2ED3A5", DARK_INK],
  literature: ["#A3154F", WHITE],
  linguistics: ["#BBDD2E", DARK_INK],
  art: ["#FF8A70", DARK_INK],
  biology: ["#17794A", WHITE],
  medicine: ["#39C3E8", DARK_INK],
  physics: ["#1B1E7A", WHITE],
  chemistry: ["#FF9420", DARK_INK],
  mathematics: ["#B9A6FF", DARK_INK],
  computer_science: ["#0A6885", WHITE],
  engineering: ["#37507A", WHITE],
  environment: ["#74C43C", DARK_INK],
  education: ["#FFD95C", DARK_INK],
  urbanism: ["#C93410", WHITE],
  business: ["#8A5A00", WHITE],
  media: ["#FFB3C7", DARK_INK],
  public_policy: ["#3C2A9E", WHITE],
  religion: ["#5C3317", WHITE],
  indigenous_studies: ["#7A2E0E", WHITE],
  music_film: ["#2A0F45", WHITE],
  sports: ["#B5122E", WHITE],
  games: ["#4D7CFF", DARK_INK],
  food: ["#F4E1C1", DARK_INK],
  outdoors: ["#556B2F", WHITE],
};

const SEATS = 8;

export interface FlyerOptions {
  /** The topic's first field sets the ink. */
  field?: string;
  question?: boolean;
  /** How many seats are already torn off. */
  taken?: number;
  /** A decorative flyer isn't the page's heading, and screen readers skip it. */
  decorative?: boolean;
}

/** A topic drawn as the app draws it: a sheet of coloured paper with seats to tear off. */
export function flyer(title: string, body: unknown, { field = "", question = false, taken = 2, decorative = false }: FlyerOptions) {
  const [bg, fg] = INKS[field] ?? ["#FF5FAE", DARK_INK];
  const size = title.length > 48 ? " long" : title.length > 26 ? " medium" : "";
  const seats = Array.from({ length: SEATS }, (_, i) => html`<i class="${i < taken ? "taken" : ""}"></i>`);
  return html`<div class="flyer${question ? " question" : ""}${size}" style="--bg:${bg};--fg:${fg}"${decorative ? html` aria-hidden="true"` : ""}>
    <div class="sheet">${decorative ? html`<p class="ftitle">${title}</p>` : html`<h1 class="ftitle">${title}</h1>`}${body}</div>
    <div class="seats" aria-hidden="true">${seats}</div>
  </div>`;
}

export const FLYER_STYLE = `
.poster { display: grid; grid-template-columns: minmax(0, 21rem) minmax(0, 1fr); gap: clamp(32px, 5vw, 64px); align-items: center; }
.flyer { position: relative; container-type: inline-size; filter: drop-shadow(0 12px 20px rgba(21, 23, 61, .2)); transform: rotate(-2deg); }
.flyer::before { content: ""; position: absolute; z-index: 1; top: 12px; left: 50%; width: 14px; height: 14px; margin-left: -7px; border-radius: 50%; background: var(--fg); opacity: .85; }
.sheet { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: center; gap: 14px; aspect-ratio: 3 / 3.5; padding: 44px 26px 24px; background: var(--bg); color: var(--fg); border-radius: 8px 8px 0 0; }
.flyer.question .sheet::after { content: "?"; position: absolute; right: -6cqw; top: -22cqw; font: 800 110cqw/1 "Bricolage", sans-serif; opacity: .14; pointer-events: none; }
.sheet > * { position: relative; z-index: 1; margin: 0; }
.ftitle { font: 800 13cqw/1.03 "Bricolage", system-ui, sans-serif; letter-spacing: -.015em; text-wrap: balance; overflow-wrap: break-word; margin: 0; }
.medium .ftitle { font-size: 11cqw; }
.long .ftitle { font-size: 9.4cqw; }
.seats { display: flex; gap: 2px; height: 40px; }
.seats i { flex: 1; background: var(--bg); border-radius: 0 0 4px 4px; }
.seats i.taken { background: transparent; box-shadow: inset 0 5px 0 var(--bg); border-radius: 0; }
.fan { position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.fan .flyer:nth-child(odd) { transform: rotate(-3deg); }
.fan .flyer:nth-child(even) { transform: translateY(28px) rotate(3deg); }
.fan .sheet { padding: 34px 16px 14px; }
.fan .seats { height: 22px; }
@media (max-width: 760px) { .poster { grid-template-columns: minmax(0, 1fr); } .poster > .flyer { max-width: 21rem; width: 100%; } .poster > .fan { order: 2; padding-bottom: 28px; } .sheet { aspect-ratio: auto; min-height: 19rem; } .fan .sheet { min-height: 0; aspect-ratio: 3 / 3.5; } }
`;
