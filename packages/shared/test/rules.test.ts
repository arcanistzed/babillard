import { webcrypto } from "node:crypto";
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
  createKeyBackup,
  openKeyBackup,
  FIELD_GROUPS,
  FIELDS,
  leanSummary,
  outcomeSummary,
  meetupDays,
  meetupSlotAt,
  meetupTimes,
  deviceKeyFromSecret,
  fromBase64,
  generateDeviceKey,
  openMessage,
  openWithContentKey,
  sealMessage,
  securityCode,
  toBase64,
  defaultOpeners,
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
    expect(labels[0]).toBe("Lunch today");
    expect(labels).toContain("Tomorrow evening");
    const lateMorning = suggestMeetupSlots(new Date(2026, 10, 4, 11, 30)).map((slot) => slot.label);
    expect(lateMorning).not.toContain("Lunch today");
    expect(lateMorning[0]).toBe("This evening");
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

describe("defaultOpeners", () => {
  it("names the topic for interests, and asks for a view on questions", () => {
    expect(defaultOpeners("interest", "Poetry")[0]).toContain("Poetry");
    expect(defaultOpeners("question", "Should zoos exist?")[0]).toBe("Where do you land on this, and why?");
  });
});

describe("end-to-end encryption", () => {
  const random = (length: number) => webcrypto.getRandomValues(new Uint8Array(length));
  const [alice, bob, carol] = [generateDeviceKey(random), generateDeviceKey(random), generateDeviceKey(random)];
  const context = { conversationId: "chat-1", senderId: "alice" };
  const seal = (text: string, readers = [alice.publicKey, bob.publicKey]) => sealMessage({ text, ...context, sender: alice, readers, random });

  it("lets every reader open a message, including the sender's own device", () => {
    const envelope = seal("Bonjour, ça va? 🙂");
    expect(openMessage({ envelope, ...context, me: bob })?.text).toBe("Bonjour, ça va? 🙂");
    expect(openMessage({ envelope, ...context, me: alice })?.text).toBe("Bonjour, ça va? 🙂");
    expect(JSON.stringify(envelope)).not.toContain("Bonjour");
  });

  it("gives someone who isn't a reader nothing", () => {
    expect(openMessage({ envelope: seal("private"), ...context, me: carol })).toBeNull();
  });

  it("uses a fresh key and nonce for each message", () => {
    const [first, second] = [seal("same"), seal("same")];
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(openMessage({ envelope: first, ...context, me: bob })?.contentKey).not.toBe(openMessage({ envelope: second, ...context, me: bob })?.contentKey);
  });

  it("refuses a message moved to another chat or credited to someone else", () => {
    const envelope = seal("moved");
    expect(openMessage({ envelope, conversationId: "chat-2", senderId: "alice", me: bob })).toBeNull();
    expect(openMessage({ envelope, conversationId: "chat-1", senderId: "carol", me: bob })).toBeNull();
  });

  it("refuses an altered message, and a key the sender isn't known to have", () => {
    const envelope = seal("original");
    const altered = { ...envelope, ciphertext: `${envelope.ciphertext.startsWith("A") ? "B" : "A"}${envelope.ciphertext.slice(1)}` };
    expect(openMessage({ envelope: altered, ...context, me: bob })).toBeNull();
    expect(openMessage({ envelope, ...context, me: bob, senderKeys: [carol.publicKey] })).toBeNull();
    expect(openMessage({ envelope, ...context, me: bob, senderKeys: [alice.publicKey] })?.text).toBe("original");
  });

  it("lets a message key prove that one message's text, and only that one", () => {
    const [reported, other] = [seal("the bad one"), seal("something else")];
    const { contentKey } = openMessage({ envelope: reported, ...context, me: bob })!;
    expect(openWithContentKey(reported, context.conversationId, context.senderId, contentKey)).toBe("the bad one");
    expect(openWithContentKey(other, context.conversationId, context.senderId, contentKey)).toBeNull();
  });

  it("keeps a device's key working when reloaded from storage", () => {
    const restored = deviceKeyFromSecret(fromBase64(toBase64(bob.secretKey)));
    expect(restored.publicKey).toBe(bob.publicKey);
    expect(openMessage({ envelope: seal("after restart"), ...context, me: restored })?.text).toBe("after restart");
  });

  it("round-trips base64 at every padding length", () => {
    for (const length of [0, 1, 2, 3, 4, 31, 32, 33]) {
      const bytes = random(length);
      expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
    }
  });

  it("gives the same security code whatever the order, and a new one when a device changes", () => {
    const code = securityCode([alice.publicKey, bob.publicKey]);
    expect(securityCode([bob.publicKey, alice.publicKey])).toBe(code);
    expect(securityCode([alice.publicKey, bob.publicKey, carol.publicKey])).not.toBe(code);
    expect(code).toMatch(/^\d{5} \d{5} \d{5} \d{5}$/);
  });
});

describe("picking a custom meetup time", () => {
  const now = new Date(2026, 10, 7, 13, 10);

  it("offers three weeks of days, starting today", () => {
    const days = meetupDays(now);
    expect(days).toHaveLength(21);
    expect(days[0]!.getDate()).toBe(7);
    expect(days[20]!.getDate()).toBe(27);
  });

  it("skips times less than an hour away today, and offers the whole day tomorrow", () => {
    const today = meetupTimes(meetupDays(now)[0]!, now);
    expect(today[0]!.getHours()).toBe(14);
    expect(today[0]!.getMinutes()).toBe(30);
    const tomorrow = meetupTimes(meetupDays(now)[1]!, now);
    expect(tomorrow[0]!.getHours()).toBe(7);
    expect(tomorrow.at(-1)!.getHours()).toBe(22);
  });

  it("offers nothing on a day that's already over", () => {
    expect(meetupTimes(meetupDays(now)[0]!, new Date(2026, 10, 7, 22, 30))).toEqual([]);
  });

  it("makes a two-hour slot", () => {
    const { startsAt, endsAt } = meetupSlotAt(new Date(2026, 10, 8, 18));
    expect(endsAt - startsAt).toBe(2 * 60 * 60 * 1000);
  });
});

describe("how a city leans", () => {
  it("stays hidden below ten answers", () => {
    expect(leanSummary({ for: 5, against: 4 })).toBeNull();
    expect(leanSummary({})).toBeNull();
  });

  it("stays hidden when everyone agrees, since that would reveal each person's answer", () => {
    expect(leanSummary({ for: 40 })).toBeNull();
  });

  it("gives whole percentages, never counts", () => {
    expect(leanSummary({ for: 6, against: 3, unsure: 1 })).toEqual({ for: 60, against: 30, unsure: 10 });
    expect(leanSummary({ for: 2, against: 9 })).toEqual({ for: 18, against: 82, unsure: 0 });
  });
});

describe("meetup outcomes", () => {
  it("stay hidden until enough people have answered", () => {
    expect(outcomeSummary({ mindChanged: { no: 4 }, endedUp: { split: 4 }, meetAgain: { yes: 4 } })).toBeNull();
  });

  it("count both kinds of changed mind together, as percentages of answers", () => {
    expect(
      outcomeSummary({ mindChanged: { mine: 1, other: 2, no: 5 }, endedUp: { agreed: 2, split: 4, disagreed: 2 }, meetAgain: { yes: 6, maybe: 1, no: 1 } }),
    ).toEqual({ answers: 8, mindChanged: 38, agreed: 25, split: 50, disagreed: 25, meetAgain: 75 });
  });
});

describe("field groups", () => {
  it("put every field in exactly one group", () => {
    const grouped = FIELD_GROUPS.flatMap((group) => group.fields as readonly string[]);
    expect([...grouped].sort()).toEqual([...FIELDS].sort());
  });
});

describe("key backup", () => {
  const random = (length: number) => webcrypto.getRandomValues(new Uint8Array(length));
  const secrets = [random(32), random(32)];

  it("brings the keys back with the right passphrase, and opens a message on a new phone", async () => {
    const old = deviceKeyFromSecret(secrets[0]!);
    const sender = generateDeviceKey(random);
    const envelope = sealMessage({ text: "from before", conversationId: "c", senderId: "s", sender, readers: [old.publicKey], random });
    const file = JSON.stringify(await createKeyBackup(secrets, "correct horse", random));
    const restored = await openKeyBackup(file, "correct horse");
    expect(restored?.map(toBase64)).toEqual(secrets.map(toBase64));
    expect(openMessage({ envelope, conversationId: "c", senderId: "s", me: deviceKeyFromSecret(restored![0]!) })?.text).toBe("from before");
  }, 30_000);

  it("gives nothing for a wrong passphrase, or a file that isn't a backup", async () => {
    const file = JSON.stringify(await createKeyBackup(secrets, "correct horse", random));
    expect(await openKeyBackup(file, "wrong horse")).toBeNull();
    expect(await openKeyBackup("{}", "correct horse")).toBeNull();
    expect(await openKeyBackup("not json", "correct horse")).toBeNull();
  }, 30_000);

  it("doesn't contain the keys in readable form", async () => {
    const file = JSON.stringify(await createKeyBackup(secrets, "correct horse", random));
    expect(file).not.toContain(toBase64(secrets[0]!));
  }, 30_000);
});
