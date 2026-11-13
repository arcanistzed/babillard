import { NEAR_AGE_YEARS, PEOPLE_PAGE_SIZE, type LookingFor } from "../constants";

/** The ages someone wants to meet. Null at either end means no limit there. */
export interface AgeRange {
  ageMin: number | null;
  ageMax: number | null;
}

/** Someone's age and the ages they want to meet. Age is null only for accounts without a date of birth. */
export interface AgedPerson extends AgeRange {
  age: number | null;
}

export const OPEN_AGE_RANGE: AgeRange = { ageMin: null, ageMax: null };

function withinRange(age: number | null, range: AgeRange): boolean {
  if (range.ageMin === null && range.ageMax === null) return true;
  if (age === null) return false;
  return (range.ageMin === null || age >= range.ageMin) && (range.ageMax === null || age <= range.ageMax);
}

/** True when each person's age falls in the other's range, so neither is shown someone they ruled out, or shown to them. */
export function inAgeRange(a: AgedPerson, b: AgedPerson): boolean {
  return withinRange(b.age, a) && withinRange(a.age, b);
}

export interface PersonCandidate extends Partial<AgedPerson> {
  userId: string;
  sharedTopicIds: string[];
  lookingFor: LookingFor[];
  campusId: string | null;
}

export interface RankPeopleViewer extends Partial<AgedPerson> {
  lookingFor: LookingFor[];
  campusId: string | null;
}

const SAME_CAMPUS_BOOST = 2;
const NEAR_AGE_BOOST = 1;

function aged(person: Partial<AgedPerson>): AgedPerson {
  return { age: person.age ?? null, ageMin: person.ageMin ?? null, ageMax: person.ageMax ?? null };
}

export function scorePerson(person: PersonCandidate, viewer: RankPeopleViewer): number {
  const overlap = person.lookingFor.filter((item) => viewer.lookingFor.includes(item)).length;
  const sameCampus = viewer.campusId !== null && viewer.campusId === person.campusId;
  const nearAge = person.age != null && viewer.age != null && Math.abs(person.age - viewer.age) <= NEAR_AGE_YEARS;
  return person.sharedTopicIds.length * 2 + overlap + (sameCampus ? SAME_CAMPUS_BOOST : 0) + (nearAge ? NEAR_AGE_BOOST : 0);
}

/** Drops people with no shared topic or outside either person's age range, then sorts the rest. */
export function rankPeople<T extends PersonCandidate>(people: T[], viewer: RankPeopleViewer, limit = PEOPLE_PAGE_SIZE): T[] {
  return people
    .filter((person) => person.sharedTopicIds.length > 0 && inAgeRange(aged(viewer), aged(person)))
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
