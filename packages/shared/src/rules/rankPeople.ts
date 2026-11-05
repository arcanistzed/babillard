import { PEOPLE_PAGE_SIZE, type LookingFor } from "../constants";

export interface PersonCandidate {
  userId: string;
  sharedTopicIds: string[];
  lookingFor: LookingFor[];
  campusId: string | null;
}

export interface RankPeopleViewer {
  lookingFor: LookingFor[];
  campusId: string | null;
}

const SAME_CAMPUS_BOOST = 2;

export function scorePerson(person: PersonCandidate, viewer: RankPeopleViewer): number {
  const overlap = person.lookingFor.filter((item) => viewer.lookingFor.includes(item)).length;
  const sameCampus = viewer.campusId !== null && viewer.campusId === person.campusId;
  return person.sharedTopicIds.length * 2 + overlap + (sameCampus ? SAME_CAMPUS_BOOST : 0);
}

export function rankPeople<T extends PersonCandidate>(people: T[], viewer: RankPeopleViewer, limit = PEOPLE_PAGE_SIZE): T[] {
  return people
    .filter((person) => person.sharedTopicIds.length > 0)
    .map((person) => ({ person, score: scorePerson(person, viewer) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.person);
}

/**
 * "More than friends" is private unless both people set it.
 * Every API response that shows a person's chips must go through this.
 */
export function visibleLookingFor(target: LookingFor[], viewer: LookingFor[]): LookingFor[] {
  const mutual = viewer.includes("more_than_friends") && target.includes("more_than_friends");
  return mutual ? target : target.filter((item) => item !== "more_than_friends");
}
