import { describe, expect, it } from "vitest";
import {
  DEFAULT_JOB_OFFSETS as OFFSETS,
  canJoin,
  formGroups,
  institutionDomain,
  isAdult,
  isCheckinDue,
  isMatchExpired,
  isMeetupConfirmed,
  isMutualMatch,
  isNudgeDue,
  isProposalStale,
  isReminderDue,
  matchExpiresAt,
  matchOpenerMessage,
  orderedPair,
  pickOpener,
  rankPeople,
  rankTopics,
  requiredYesCount,
  scorePerson,
  suggestMeetupSlots,
  topicPhrase,
  scoreTopic,
  visibleLookingFor,
  campusForDomain,
  nearestCity,
  searchCities,
  type Locality,
  type MatchTiming,
  type MeetupTiming,
  type Waiter,
} from "../src";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

describe("rankTopics", () => {
  const noJitter = () => 0;

  it("weights field overlap three times", () => {
    expect(scoreTopic({ id: "t", fieldTags: ["law", "politics"], cohortSize: 0 }, ["law", "politics"], 0)).toBe(6);
  });

  it("caps cohort size at one short of a group", () => {
    expect(scoreTopic({ id: "t", fieldTags: [], cohortSize: 3 }, [], 0)).toBe(3);
    expect(scoreTopic({ id: "t", fieldTags: [], cohortSize: 500 }, [], 0)).toBe(3);
  });

  it("orders by score and respects the limit", () => {
    const topics = [
      { id: "none", fieldTags: ["art"], cohortSize: 0 },
      { id: "field", fieldTags: ["law"], cohortSize: 0 },
      { id: "near", fieldTags: ["art"], cohortSize: 2 },
    ];
    const ranked = rankTopics(topics, { userFields: ["law"], random: noJitter, limit: 2 });
    expect(ranked.map((t) => t.id)).toEqual(["field", "near"]);
  });

  it("uses jitter to break ties", () => {
    const topics = [
      { id: "a", fieldTags: [], cohortSize: 0 },
      { id: "b", fieldTags: [], cohortSize: 0 },
    ];
    const values = [0.1, 0.9];
    const ranked = rankTopics(topics, { userFields: [], random: () => values.shift() ?? 0 });
    expect(ranked[0]?.id).toBe("b");
  });
});

describe("rankPeople", () => {
  const viewer = { lookingFor: ["learning", "debate"] as const, campusId: "campus-1" };
  const v = { lookingFor: [...viewer.lookingFor], campusId: viewer.campusId };

  it("scores shared topics, looking-for overlap and same campus", () => {
    const score = scorePerson({ userId: "u", sharedTopicIds: ["a", "b"], lookingFor: ["debate"], campusId: "campus-1" }, v);
    expect(score).toBe(2 * 2 + 1 + 2);
  });

  it("gives no campus boost when the viewer has no campus", () => {
    const score = scorePerson({ userId: "u", sharedTopicIds: ["a"], lookingFor: [], campusId: null }, { lookingFor: [], campusId: null });
    expect(score).toBe(2);
  });

  it("drops people with no shared topic and sorts the rest", () => {
    const ranked = rankPeople(
      [
        { userId: "none", sharedTopicIds: [], lookingFor: ["debate"], campusId: "campus-1" },
        { userId: "one", sharedTopicIds: ["a"], lookingFor: [], campusId: null },
        { userId: "two", sharedTopicIds: ["a", "b"], lookingFor: [], campusId: null },
      ],
      v,
    );
    expect(ranked.map((p) => p.userId)).toEqual(["two", "one"]);
  });
});

describe("visibleLookingFor", () => {
  it("hides more_than_friends unless both people set it", () => {
    expect(visibleLookingFor(["friends", "more_than_friends"], ["friends"])).toEqual(["friends"]);
    expect(visibleLookingFor(["friends"], ["more_than_friends"])).toEqual(["friends"]);
  });

  it("shows it when mutual", () => {
    expect(visibleLookingFor(["more_than_friends"], ["more_than_friends", "learning"])).toEqual(["more_than_friends"]);
  });
});

describe("match", () => {
  it("requires two right swipes", () => {
    expect(isMutualMatch("right", "right")).toBe(true);
    expect(isMutualMatch("right", "left")).toBe(false);
    expect(isMutualMatch("left", "right")).toBe(false);
    expect(isMutualMatch("right", null)).toBe(false);
  });

  it("orders pairs the same way from either side", () => {
    expect(orderedPair("b", "a")).toEqual(orderedPair("a", "b"));
  });

  it("builds the opener message", () => {
    expect(matchOpenerMessage("housing policy", "Where would you start?")).toBe("You both want to dig into housing policy. Where would you start?");
  });

  it("quotes question topics so the sentence still reads", () => {
    expect(matchOpenerMessage("Should zoos exist?", "Do you visit them?")).toBe("You both want to dig into \u201cShould zoos exist?\u201d Do you visit them?");
    expect(topicPhrase("Poetry")).toBe("Poetry");
  });

  it("falls back when a topic has no openers", () => {
    expect(pickOpener([])).toMatch(/\?$/);
    expect(pickOpener(["a", "b"], () => 0.99)).toBe("b");
  });
});

describe("formGroups", () => {
  const waiter = (userId: string, joinedAt: number, stance: Waiter["stance"] = null): Waiter => ({ userId, joinedAt, stance });
  const people = (count: number): Waiter[] => Array.from({ length: count }, (_, i) => waiter(`u${i}`, i));

  it("does not form below four", () => {
    expect(formGroups({ waiting: people(3), topicKind: "interest", blocks: [] })).toBeNull();
  });

  it("forms at exactly four", () => {
    expect(formGroups({ waiting: people(4), topicKind: "interest", blocks: [] })).toEqual(["u0", "u1", "u2", "u3"]);
  });

  it("caps at eight, oldest first", () => {
    const group = formGroups({ waiting: people(11), topicKind: "interest", blocks: [] });
    expect(group).toHaveLength(8);
    expect(group).toEqual(["u0", "u1", "u2", "u3", "u4", "u5", "u6", "u7"]);
  });

  it("never places a blocked pair together", () => {
    const group = formGroups({ waiting: people(5), topicKind: "interest", blocks: [["u1", "u0"]] });
    expect(group).toEqual(["u0", "u2", "u3", "u4"]);
  });

  it("does not form when blocks leave too few compatible people", () => {
    expect(formGroups({ waiting: people(4), topicKind: "interest", blocks: [["u0", "u3"]] })).toBeNull();
  });

  it("swaps in a different stance when a question's group would be unanimous", () => {
    const waiting = [waiter("a", 0, "for"), waiter("b", 1, "for"), waiter("c", 2, "for"), waiter("d", 3, "for"), waiter("e", 4, "against")];
    const group = formGroups({ waiting, topicKind: "question", blocks: [], maxSize: 4 });
    expect(group).toEqual(["a", "b", "c", "e"]);
  });

  it("does not let stance hold a unanimous group back", () => {
    const waiting = [waiter("a", 0, "for"), waiter("b", 1, "for"), waiter("c", 2, "for"), waiter("d", 3, "for")];
    expect(formGroups({ waiting, topicKind: "question", blocks: [] })).toEqual(["a", "b", "c", "d"]);
  });

  it("ignores stance on interest topics", () => {
    const waiting = [waiter("a", 0, "for"), waiter("b", 1, "for"), waiter("c", 2, "for"), waiter("d", 3, "for"), waiter("e", 4, "against")];
    expect(formGroups({ waiting, topicKind: "interest", blocks: [], maxSize: 4 })).toEqual(["a", "b", "c", "d"]);
  });

  it("does not swap in someone blocked by the remaining members", () => {
    const waiting = [waiter("a", 0, "for"), waiter("b", 1, "for"), waiter("c", 2, "for"), waiter("d", 3, "for"), waiter("e", 4, "against")];
    expect(formGroups({ waiting, topicKind: "question", blocks: [["a", "e"]], maxSize: 4 })).toEqual(["a", "b", "c", "d"]);
  });

  it("canJoin checks both block directions", () => {
    expect(canJoin("x", ["a", "b"], [["b", "x"]])).toBe(false);
    expect(canJoin("x", ["a", "b"], [["x", "b"]])).toBe(false);
    expect(canJoin("x", ["a", "b"], [["a", "b"]])).toBe(true);
  });
});

describe("meetups", () => {
  it("direct chats need both people", () => {
    expect(isMeetupConfirmed("direct", 1, 2)).toBe(false);
    expect(isMeetupConfirmed("direct", 2, 2)).toBe(true);
  });

  it("groups need three yeses", () => {
    expect(isMeetupConfirmed("group", 2, 6)).toBe(false);
    expect(isMeetupConfirmed("group", 3, 6)).toBe(true);
  });

  it("a shrunken group needs everyone left", () => {
    expect(requiredYesCount("group", 2)).toBe(2);
    expect(requiredYesCount("group", 8)).toBe(3);
  });
});

describe("timed jobs", () => {
  const created = 1_000_000;
  const match = (overrides: Partial<MatchTiming> = {}): MatchTiming => ({
    createdAt: created,
    expiresAt: matchExpiresAt(created, OFFSETS),
    nudgedAt: null,
    lastUserMessageAt: null,
    state: "active",
    ...overrides,
  });

  it("nudges from day five on silent matches, once", () => {
    expect(isNudgeDue(match(), created + 5 * DAY - 1, OFFSETS)).toBe(false);
    expect(isNudgeDue(match(), created + 5 * DAY, OFFSETS)).toBe(true);
    expect(isNudgeDue(match({ nudgedAt: created }), created + 5 * DAY, OFFSETS)).toBe(false);
    expect(isNudgeDue(match({ lastUserMessageAt: created }), created + 5 * DAY, OFFSETS)).toBe(false);
  });

  it("expires silent matches at day seven only", () => {
    expect(isMatchExpired(match(), created + 7 * DAY - 1)).toBe(false);
    expect(isMatchExpired(match(), created + 7 * DAY)).toBe(true);
    expect(isMatchExpired(match({ lastUserMessageAt: created + 1 }), created + 8 * DAY)).toBe(false);
    expect(isMatchExpired(match({ state: "closed" }), created + 8 * DAY)).toBe(false);
  });

  const meetup = (overrides: Partial<MeetupTiming> = {}): MeetupTiming => ({
    startsAt: created + DAY,
    endsAt: created + DAY + HOUR,
    state: "confirmed",
    reminderSentAt: null,
    checkinSentAt: null,
    ...overrides,
  });

  it("reminds two hours before a confirmed meetup, once", () => {
    const start = created + DAY;
    expect(isReminderDue(meetup(), start - 2 * HOUR - 1, OFFSETS)).toBe(false);
    expect(isReminderDue(meetup(), start - 2 * HOUR, OFFSETS)).toBe(true);
    expect(isReminderDue(meetup(), start, OFFSETS)).toBe(false);
    expect(isReminderDue(meetup({ reminderSentAt: 1 }), start - HOUR, OFFSETS)).toBe(false);
    expect(isReminderDue(meetup({ state: "proposed" }), start - HOUR, OFFSETS)).toBe(false);
  });

  it("asks did-you-meet a day after it ends", () => {
    const end = created + DAY + HOUR;
    expect(isCheckinDue(meetup(), end + DAY - 1, OFFSETS)).toBe(false);
    expect(isCheckinDue(meetup(), end + DAY, OFFSETS)).toBe(true);
    expect(isCheckinDue(meetup({ checkinSentAt: 1 }), end + DAY, OFFSETS)).toBe(false);
  });

  it("marks unconfirmed proposals stale at their start time", () => {
    expect(isProposalStale(meetup({ state: "proposed" }), created + DAY)).toBe(true);
    expect(isProposalStale(meetup({ state: "confirmed" }), created + DAY)).toBe(false);
  });
});

describe("identity", () => {
  const now = new Date("2026-11-04T12:00:00Z");

  it("allows people from their 18th birthday", () => {
    expect(isAdult("2008-11-04", now)).toBe(true);
    expect(isAdult("2008-11-05", now)).toBe(false);
    expect(isAdult("1990-01-01", now)).toBe(true);
  });

  it("rejects impossible dates", () => {
    expect(isAdult("2000-02-31", now)).toBe(false);
    expect(isAdult("nope", now)).toBe(false);
  });

  it("recognises institution email", () => {
    expect(institutionDomain("Sam@Cs.Stanford.EDU")).toBe("cs.stanford.edu");
    expect(institutionDomain("a@ox.ac.uk")).toBe("ox.ac.uk");
    expect(institutionDomain("a@mail.utoronto.ca")).toBe("utoronto.ca");
    expect(institutionDomain("a@gmail.com")).toBeNull();
    expect(institutionDomain("a@fake-edu.com")).toBeNull();
  });
});

describe("suggestMeetupSlots", () => {
  // Wednesday 4 November 2026, 10:00 local time.
  const wednesday = new Date(2026, 10, 4, 10);

  it("offers six future times, in order", () => {
    const slots = suggestMeetupSlots(wednesday);
    expect(slots).toHaveLength(6);
    expect(slots.every((slot) => slot.startsAt > wednesday.getTime() && slot.endsAt > slot.startsAt)).toBe(true);
    expect(slots.map((slot) => slot.startsAt)).toEqual(slots.map((slot) => slot.startsAt).sort((a, b) => a - b));
  });

  it("names today and tomorrow, and skips anything too soon", () => {
    const labels = suggestMeetupSlots(wednesday).map((slot) => slot.label);
    expect(labels[0]).toBe("Today lunch");
    expect(labels).toContain("Tomorrow evening");
    const lateMorning = suggestMeetupSlots(new Date(2026, 10, 4, 11, 30)).map((slot) => slot.label);
    expect(lateMorning).not.toContain("Today lunch");
    expect(lateMorning[0]).toBe("Today evening");
  });

  it("always includes the weekend", () => {
    const labels = suggestMeetupSlots(wednesday).map((slot) => slot.label);
    expect(labels.some((label) => label.startsWith("Saturday") || label.startsWith("Sunday"))).toBe(true);
  });

  it("works late on a Saturday night", () => {
    const slots = suggestMeetupSlots(new Date(2026, 10, 7, 23));
    expect(slots).toHaveLength(6);
    expect(slots[0]?.label).toBe("Tomorrow morning");
  });
});

describe("searchCities", () => {
  const city = (id: string, name: string, region: string, country: string, countryCode: string, population: number, aliases: string[] = []): Locality => ({ id, slug: id, name, kind: "city", parentId: null, region, country, countryCode, population, aliases, latitude: 0, longitude: 0 });
  const cities = [
    city("toronto", "Toronto", "Ontario", "Canada", "CA", 2_794_000, ["Mississauga"]),
    city("montreal", "Montréal", "Quebec", "Canada", "CA", 1_762_000, ["Laval"]),
    city("ottawa", "Ottawa", "Ontario", "Canada", "CA", 1_017_000, ["Gatineau"]),
    city("london-uk", "London", "England", "United Kingdom", "GB", 8_900_000),
    city("london-on", "London", "Ontario", "Canada", "CA", 422_000),
    city("paris", "Paris", "Île-de-France", "France", "FR", 2_100_000),
    { ...city("uottawa", "uOttawa", "", "", "", 0), kind: "campus" as const, parentId: "ottawa" },
  ];
  const ids = (query: string) => searchCities(cities, query).map((item) => item.id);

  it("suggests major Canadian cities, biggest first, when nothing is typed", () => {
    expect(ids("")).toEqual(["toronto", "montreal", "ottawa", "london-on"]);
  });

  it("ignores accents and case", () => {
    expect(ids("montreal")).toEqual(["montreal"]);
    expect(ids("MONTRÉAL")).toEqual(["montreal"]);
  });

  it("finds a metro area by its suburb", () => {
    expect(ids("gatineau")).toEqual(["ottawa"]);
    expect(ids("missis")).toEqual(["toronto"]);
  });

  it("tells same-named cities apart by province or country", () => {
    expect(ids("london")).toEqual(["london-uk", "london-on"]);
    expect(ids("london ontario")).toEqual(["london-on"]);
    expect(ids("london, canada")).toEqual(["london-on"]);
  });

  it("puts a name match ahead of a province match", () => {
    expect(ids("ot")[0]).toBe("ottawa");
  });

  it("finds cities in a country or province", () => {
    expect(ids("france")).toEqual(["paris"]);
    expect(ids("ontario")).toEqual(["toronto", "ottawa", "london-on"]);
  });

  it("never returns campuses, and returns nothing for no match", () => {
    expect(ids("uottawa")).toEqual([]);
    expect(ids("zzzz")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(searchCities(cities, "", 2)).toHaveLength(2);
  });
});

describe("Canadian school email", () => {
  it("recognises Canadian universities, including student subdomains", () => {
    expect(institutionDomain("student@uottawa.ca")).toBe("uottawa.ca");
    expect(institutionDomain("a@cmail.carleton.ca")).toBe("carleton.ca");
    expect(institutionDomain("a@mail.mcgill.ca")).toBe("mcgill.ca");
    expect(institutionDomain("a@student.ubc.ca")).toBe("ubc.ca");
  });

  it("does not match lookalike domains", () => {
    expect(institutionDomain("a@notuottawa.ca")).toBeNull();
    expect(institutionDomain("a@uottawa.ca.evil.com")).toBeNull();
  });
});

describe("nearestCity", () => {
  const place = (id: string, latitude: number, longitude: number, kind: "city" | "campus" = "city"): Locality => ({ id, slug: id, name: id, kind, parentId: null, region: "", country: "", countryCode: "", population: 0, aliases: [], latitude, longitude });
  const places = [place("ottawa", 45.411, -75.698), place("montreal", 45.509, -73.588), place("toronto", 43.701, -79.416), place("london-uk", 51.509, -0.126), place("london-on", 42.983, -81.233), place("uottawa", 45.423, -75.683, "campus")];

  it("picks the closest city", () => {
    expect(nearestCity(places, 45.477, -75.701)?.id).toBe("ottawa");
    expect(nearestCity(places, 45.52, -73.6)?.id).toBe("montreal");
    expect(nearestCity(places, 43.0, -81.2)?.id).toBe("london-on");
  });

  it("works across the antimeridian without wrapping the wrong way", () => {
    const pacific = [place("east", 0, 179), place("west", 0, 170)];
    expect(nearestCity(pacific, 0, -179)?.id).toBe("east");
  });

  it("never picks a campus, and returns null with no cities", () => {
    expect(nearestCity(places, 45.423, -75.683)?.id).toBe("ottawa");
    expect(nearestCity([], 0, 0)).toBeNull();
  });
});

describe("campusForDomain", () => {
  it("maps a verified school domain to its campus", () => {
    expect(campusForDomain("uottawa.ca")).toBe("uottawa");
    expect(campusForDomain("cmail.carleton.ca")).toBe("carleton-university");
    expect(campusForDomain("cs.stanford.edu")).toBe("stanford");
  });

  it("returns null for anything else", () => {
    expect(campusForDomain("gmail.com")).toBeNull();
    expect(campusForDomain("notuottawa.ca")).toBeNull();
    expect(campusForDomain(null)).toBeNull();
    expect(campusForDomain(undefined)).toBeNull();
  });
});
