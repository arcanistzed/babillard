import { DECK_PAGE_SIZE, GROUP_MIN_SIZE } from "../constants";

export interface TopicCandidate {
  id: string;
  fieldTags: string[];
  /** People in the viewer's city who already swiped right on this topic. */
  cohortSize: number;
}

export interface RankTopicsOptions {
  userFields: string[];
  random?: () => number;
  limit?: number;
}

/** Field overlap counts most. Cohort size is capped at one short of a group, so near-forming topics float up. */
export function scoreTopic(topic: TopicCandidate, userFields: string[], jitter: number): number {
  const overlap = topic.fieldTags.filter((tag) => userFields.includes(tag)).length;
  const cohort = Math.min(topic.cohortSize, GROUP_MIN_SIZE - 1);
  return overlap * 3 + cohort + jitter;
}

export function rankTopics<T extends TopicCandidate>(topics: T[], options: RankTopicsOptions): T[] {
  const random = options.random ?? Math.random;
  return topics
    .map((topic) => ({ topic, score: scoreTopic(topic, options.userFields, random()) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? DECK_PAGE_SIZE)
    .map((entry) => entry.topic);
}
