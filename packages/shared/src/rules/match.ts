import { LEAN_MIN_ANSWERS, type Stance } from "../constants";

export function orderedPair(userA: string, userB: string): [string, string] {
  return userA < userB ? [userA, userB] : [userB, userA];
}

export function isMutualMatch(mine: "right" | "left", theirs: "right" | "left" | null | undefined): boolean {
  return mine === "right" && theirs === "right";
}

export function pickOpener(openers: string[], random: () => number = Math.random): string {
  if (openers.length === 0) return "What pulled you toward this topic?";
  return openers[Math.floor(random() * openers.length)] ?? openers[0]!;
}

/** The same opener in both languages, since everyone in a chat sees the one message in their own language. */
export function pickBilingualOpener(topic: { openers: string[]; fr?: { openers: string[] } | null } | undefined, random: () => number = Math.random): { en: string; fr: string } {
  const openers = topic?.openers ?? [];
  if (openers.length === 0) return { en: "What pulled you toward this topic?", fr: "Qu'est-ce qui vous attire dans ce sujet?" };
  const index = Math.floor(random() * openers.length);
  const en = openers[index] ?? openers[0]!;
  return { en, fr: topic?.fr?.openers[index] ?? en };
}

/** Question topics are full sentences, so they need quoting to sit inside another sentence. */
export function topicPhrase(topicTitle: string, language: "en" | "fr" = "en"): string {
  if (!topicTitle.endsWith("?")) return topicTitle;
  return language === "fr" ? `\u00ab ${topicTitle} \u00bb` : `\u201c${topicTitle}\u201d`;
}

export function matchOpenerMessage(topicTitle: string, opener: string, language: "en" | "fr" = "en"): string {
  const stop = topicTitle.endsWith("?") ? "" : ".";
  const lead = language === "fr" ? "Vous voulez tous les deux explorer" : "You both want to dig into";
  return `${lead} ${topicPhrase(topicTitle, language)}${stop} ${opener}`;
}

/** Starting points for a newly approved topic. A moderator can edit them before approving. */
export function defaultOpeners(kind: "interest" | "question", title: string): string[] {
  return kind === "question"
    ? ["Where do you land on this, and why?", "What would change your mind?"]
    : [`What got you interested in ${title}?`, "What should I read or look at first?"];
}

export type Lean = Record<Stance, number>;

/**
 * How a city leans on a question, as whole percentages. Hidden below a minimum
 * number of answers, and when everyone agrees, because then the total would
 * reveal how each person answered.
 */
export function leanSummary(counts: Partial<Record<Stance, number>>): Lean | null {
  const [yes, no, unsure] = [counts.for ?? 0, counts.against ?? 0, counts.unsure ?? 0];
  const total = yes + no + unsure;
  if (total < LEAN_MIN_ANSWERS || Math.max(yes, no, unsure) === total) return null;
  return { for: Math.round((yes / total) * 100), against: Math.round((no / total) * 100), unsure: Math.round((unsure / total) * 100) };
}
