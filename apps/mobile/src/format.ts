import { t } from "./i18n";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Reads like speech: "today at 6:00 PM", "tomorrow at 12:00 PM", "Sat, Nov 7 at 2:00 PM". */
export function describeWhen(ms: number, now: Date = new Date()): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (isSameDay(date, now)) return t(`today at ${time}`, `aujourd'hui à ${time}`);
  if (isSameDay(date, new Date(now.getTime() + DAY))) return t(`tomorrow at ${time}`, `demain à ${time}`);
  const day = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return t(`${day} at ${time}`, `${day} à ${time}`);
}

export function timeLeft(expiresAt: number, now = Date.now()): string {
  const remaining = Math.max(expiresAt - now, 0);
  if (remaining >= DAY) {
    const days = Math.ceil(remaining / DAY);
    return t(`${days} ${days === 1 ? "day" : "days"}`, `${days} ${days === 1 ? "jour" : "jours"}`);
  }
  const hours = Math.max(Math.ceil(remaining / HOUR), 1);
  return t(`${hours} ${hours === 1 ? "hour" : "hours"}`, `${hours} ${hours === 1 ? "heure" : "heures"}`);
}

export function messageTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
