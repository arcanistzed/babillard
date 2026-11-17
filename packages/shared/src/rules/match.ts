import { LEAN_MIN_ANSWERS, OUTCOME_MIN_ANSWERS, type EndedUp, type MeetAgain, type MindChanged, type Stance } from "../constants";
import type { TopicOutcomes } from "../api";

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

/** An article followed by the word it belongs to: "The ", "A ", "An ", "Le ", "La ", "Les ", "L'", "Un ", "Une ", "Des ". */
const LEADING_ARTICLE = /^(?:(?:the|an?|le|la|les|une?|des)\s+|l['’]\s*)/i;

/** Letters change with case and digits don't, which covers accented letters without Unicode regex classes the app's engine may lack. */
const isLetterOrDigit = (char: string | undefined) => char !== undefined && (char.toLowerCase() !== char.toUpperCase() || (char >= "0" && char <= "9"));

/**
 * The letter on a topic's avatar. Most French titles start with an article, so without skipping
 * it nearly every group would show "L". A title that is only an article keeps its own letter.
 */
export function topicInitial(title: string): string {
  const chars = [...title];
  const first = chars.findIndex((char) => isLetterOrDigit(char));
  if (first === -1) return title.trim().charAt(0);
  const start = chars.slice(first).join("");
  const article = LEADING_ARTICLE.exec(start);
  const rest = article ? [...start.slice(article[0].length)] : [];
  return (isLetterOrDigit(rest[0]) ? rest[0]! : chars[first]!).toLocaleUpperCase();
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

/**
 * The stance totals a group is shown, from the answers of the people it formed with, or null to show nothing.
 *
 * Shown only when at least two answers differ and every answer given is shared by at least two people. A member
 * who subtracts their own answer then still sees at least one other person on their side and on another side,
 * so no one else's answer can be pinned down, and nobody is the only one with an answer.
 *
 * The totals are worked out once, when the group forms with everyone arriving together, and never change.
 * Totals that changed as people joined, left or changed their answer would give that person's answer away.
 */
export function groupStanceSpread(stances: (Stance | null)[]): Lean | null {
  const counts: Lean = { for: 0, against: 0, unsure: 0 };
  for (const stance of stances) if (stance) counts[stance] += 1;
  const given = Object.values(counts).filter((count) => count > 0);
  if (given.length < 2 || given.some((count) => count < 2)) return null;
  return counts;
}

export interface OutcomeCounts {
  mindChanged: Partial<Record<MindChanged, number>>;
  endedUp: Partial<Record<EndedUp, number>>;
  meetAgain: Partial<Record<MeetAgain, number>>;
}

/** Turns one topic's answers into percentages, or null when too few people answered to stay anonymous. */
export function outcomeSummary(counts: OutcomeCounts): TopicOutcomes | null {
  const sum = (values: Partial<Record<string, number>>) => Object.values(values).reduce<number>((total, value) => total + (value ?? 0), 0);
  const answers = sum(counts.mindChanged);
  if (answers < OUTCOME_MIN_ANSWERS) return null;
  const share = (value: number | undefined) => Math.round(((value ?? 0) / answers) * 100);
  return {
    answers,
    mindChanged: share((counts.mindChanged.mine ?? 0) + (counts.mindChanged.other ?? 0)),
    agreed: share(counts.endedUp.agreed),
    split: share(counts.endedUp.split),
    disagreed: share(counts.endedUp.disagreed),
    meetAgain: share(counts.meetAgain.yes),
  };
}
