import { DECK_PAGE_SIZE, GROUP_MIN_SIZE } from "../constants";

export interface TopicCandidate {
  id: string;
  fieldTags: string[];
  /** People in the viewer's city who already swiped right on this topic. */
  cohortSize: number;
  /** Position in the shared opening deck, or null for topics outside it. */
  starter?: number | null;
}

export interface RankTopicsOptions {
  userFields: string[];
  random?: () => number;
  limit?: number;
  /** Someone who has barely swiped yet. They see the starter topics first, in a fixed order. */
  newcomer?: boolean;
}

/** Field overlap counts most. Cohort size is capped at one short of a group, so near-forming topics float up. */
export function scoreTopic(topic: TopicCandidate, userFields: string[], jitter: number): number {
  const overlap = topic.fieldTags.filter((tag) => userFields.includes(tag)).length;
  const cohort = Math.min(topic.cohortSize, GROUP_MIN_SIZE - 1);
  return overlap * 3 + cohort + jitter;
}

/**
 * Early on, few people in a city have joined, so random decks would rarely overlap.
 * Newcomers all start from the same broad cards, which puts the first arrivals on the
 * same topics within minutes. After that, field overlap and nearby cohorts take over.
 */
export function rankTopics<T extends TopicCandidate>(topics: T[], options: RankTopicsOptions): T[] {
  const random = options.random ?? Math.random;
  const leadsWithStarters = (topic: T) => options.newcomer === true && topic.starter != null;
  const starters = topics.filter(leadsWithStarters).sort((a, b) => a.starter! - b.starter!);
  const rest = topics
    .filter((topic) => !leadsWithStarters(topic))
    .map((topic) => ({ topic, score: scoreTopic(topic, options.userFields, random()) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.topic);
  return [...starters, ...rest].slice(0, options.limit ?? DECK_PAGE_SIZE);
}
