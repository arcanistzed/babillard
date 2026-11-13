import { describe, expect, it } from "vitest";
import { ageOn, formGroups, inAgeRange, profileSaveSchema, rankPeople, scorePerson, type Waiter } from "../src";

const on = (date: string) => new Date(`${date}T12:00:00Z`);

describe("ageOn", () => {
  it("counts a birthday from the day itself", () => {
    expect(ageOn("2000-11-13", on("2026-11-12"))).toBe(25);
    expect(ageOn("2000-11-13", on("2026-11-13"))).toBe(26);
  });

  it("counts a February 29 birthday from March 1 in other years", () => {
    expect(ageOn("2004-02-29", on("2026-02-28"))).toBe(21);
    expect(ageOn("2004-02-29", on("2026-03-01"))).toBe(22);
  });

  it("returns null for a date that doesn't exist", () => {
    expect(ageOn("2001-02-29", on("2026-01-01"))).toBeNull();
    expect(ageOn("not a date")).toBeNull();
  });
});

describe("inAgeRange", () => {
  const open = { ageMin: null, ageMax: null };

  it("needs each person in the other's range", () => {
    const twenty = { age: 20, ageMin: 18, ageMax: 25 };
    const thirty = { age: 30, ...open };
    expect(inAgeRange(twenty, thirty)).toBe(false);
    expect(inAgeRange(thirty, twenty)).toBe(false);
    expect(inAgeRange(twenty, { age: 24, ageMin: 20, ageMax: null })).toBe(true);
  });

  it("treats a blank end as no limit", () => {
    expect(inAgeRange({ age: 40, ageMin: 35, ageMax: null }, { age: 70, ...open })).toBe(true);
    expect(inAgeRange({ age: 40, ageMin: null, ageMax: 45 }, { age: 19, ...open })).toBe(true);
  });

  it("only matches an unknown age with open ranges", () => {
    expect(inAgeRange({ age: null, ...open }, { age: 25, ...open })).toBe(true);
    expect(inAgeRange({ age: null, ...open }, { age: 25, ageMin: 20, ageMax: null })).toBe(false);
  });
});

describe("rankPeople with ages", () => {
  const person = (userId: string, age: number, range: { ageMin?: number; ageMax?: number } = {}) => ({
    userId,
    sharedTopicIds: ["t"],
    lookingFor: [],
    campusId: null,
    age,
    ageMin: range.ageMin ?? null,
    ageMax: range.ageMax ?? null,
  });

  it("drops people outside either range", () => {
    const viewer = { lookingFor: [], campusId: null, age: 22, ageMin: 20, ageMax: 30 };
    const ranked = rankPeople([person("too-old", 35), person("fits", 25), person("rules-out-viewer", 26, { ageMin: 25 })], viewer);
    expect(ranked.map((p) => p.userId)).toEqual(["fits"]);
  });

  it("ranks people close in age a little higher", () => {
    const viewer = { lookingFor: [], campusId: null, age: 22 };
    expect(scorePerson(person("near", 24), viewer)).toBe(scorePerson(person("far", 40), viewer) + 1);
    expect(rankPeople([person("far", 40), person("near", 24)], viewer).map((p) => p.userId)).toEqual(["near", "far"]);
  });
});

describe("formGroups with ages", () => {
  const waiter = (userId: string, joinedAt: number, age: number | null): Waiter => ({ userId, joinedAt, stance: null, age });

  it("swaps someone far from the group's age for a closer-aged person who is waiting", () => {
    const waiting = [waiter("a", 0, 21), waiter("b", 1, 22), waiter("c", 2, 55), waiter("d", 3, 23), waiter("e", 4, 24)];
    expect(formGroups({ waiting, topicKind: "interest", blocks: [], maxSize: 4 })).toEqual(["a", "b", "e", "d"]);
  });

  it("keeps the group when nobody closer in age is waiting", () => {
    const waiting = [waiter("a", 0, 21), waiter("b", 1, 22), waiter("c", 2, 55), waiter("d", 3, 23)];
    expect(formGroups({ waiting, topicKind: "interest", blocks: [], maxSize: 4 })).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves groups alone when ages are within the spread or unknown", () => {
    const waiting = [waiter("a", 0, 20), waiter("b", 1, 27), waiter("c", 2, null), waiter("d", 3, 24), waiter("e", 4, 23)];
    expect(formGroups({ waiting, topicKind: "interest", blocks: [], maxSize: 4 })).toEqual(["a", "b", "c", "d"]);
  });

  it("doesn't swap in someone blocked by a member", () => {
    const waiting = [waiter("a", 0, 21), waiter("b", 1, 22), waiter("c", 2, 55), waiter("d", 3, 23), waiter("e", 4, 24)];
    expect(formGroups({ waiting, topicKind: "interest", blocks: [["e", "a"]], maxSize: 4 })).toEqual(["a", "b", "c", "d"]);
  });
});

describe("profileSaveSchema age range", () => {
  const base = { displayName: "Dana", role: "undergrad", fields: ["law"], lookingFor: ["friends"] };

  it("accepts a range, open ends, or no range at all", () => {
    expect(profileSaveSchema.safeParse({ ...base, ageMin: 20, ageMax: 30 }).success).toBe(true);
    expect(profileSaveSchema.safeParse({ ...base, ageMin: null, ageMax: 30 }).success).toBe(true);
    expect(profileSaveSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a minimum above the maximum or an age under 18", () => {
    expect(profileSaveSchema.safeParse({ ...base, ageMin: 30, ageMax: 20 }).success).toBe(false);
    expect(profileSaveSchema.safeParse({ ...base, ageMin: 16 }).success).toBe(false);
  });
});
