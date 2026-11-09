export const GROUP_MIN_SIZE = 4;
export const GROUP_MAX_SIZE = 8;
export const GROUP_MEETUP_CONFIRM_YES = 3;
export const MIN_AGE_YEARS = 18;
export const DECK_PAGE_SIZE = 20;
/** Below this many topic swipes, someone sees the shared starter topics first. */
export const NEWCOMER_SWIPES = 20;
export const PEOPLE_PAGE_SIZE = 20;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Time-based job offsets. Dev overrides these with env vars so sweeps can be tested quickly. */
export interface JobOffsets {
  nudgeAfterMs: number;
  matchExpiryMs: number;
  meetupReminderLeadMs: number;
  meetupCheckinDelayMs: number;
}

export const DEFAULT_JOB_OFFSETS: JobOffsets = {
  nudgeAfterMs: 5 * DAY,
  matchExpiryMs: 7 * DAY,
  meetupReminderLeadMs: 2 * HOUR,
  meetupCheckinDelayMs: DAY,
};

export const LOOKING_FOR = [
  "learning",
  "networking",
  "friends",
  "more_than_friends",
  "research",
  "reading_group",
  "debate",
] as const;
export type LookingFor = (typeof LOOKING_FOR)[number];

export const LOOKING_FOR_LABELS: Record<LookingFor, string> = {
  learning: "Learning",
  networking: "Networking",
  friends: "Friends",
  more_than_friends: "Open to dating",
  research: "Research collaboration",
  reading_group: "Reading group",
  debate: "Debate",
};

export const ROLES = ["undergrad", "grad", "researcher", "other"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  undergrad: "Undergraduate",
  grad: "Graduate student",
  researcher: "Researcher",
  other: "Curious person",
};

export const FIELDS = [
  "economics",
  "politics",
  "law",
  "history",
  "philosophy",
  "sociology",
  "psychology",
  "literature",
  "linguistics",
  "art",
  "biology",
  "medicine",
  "physics",
  "chemistry",
  "mathematics",
  "computer_science",
  "engineering",
  "environment",
  "education",
  "urbanism",
  "business",
  "media",
  "public_policy",
  "religion",
  "indigenous_studies",
  "music_film",
] as const;
export type Field = (typeof FIELDS)[number];

export const FIELD_LABELS: Record<Field, string> = {
  economics: "Economics",
  politics: "Politics",
  law: "Law",
  history: "History",
  philosophy: "Philosophy",
  sociology: "Sociology",
  psychology: "Psychology",
  literature: "Literature",
  linguistics: "Linguistics",
  art: "Art & design",
  biology: "Biology",
  medicine: "Medicine & health",
  physics: "Physics",
  chemistry: "Chemistry",
  mathematics: "Mathematics",
  computer_science: "Computer science",
  engineering: "Engineering",
  environment: "Environment & climate",
  education: "Education",
  urbanism: "Cities & urbanism",
  business: "Business",
  media: "Media & journalism",
  public_policy: "Public policy",
  religion: "Religion",
  indigenous_studies: "Indigenous studies",
  music_film: "Music & film",
};

/** Broad groups, so that pickers and the deck aren't one long list of fields. */
export const FIELD_GROUPS = [
  { id: "society", fields: ["politics", "public_policy", "law", "economics", "business", "sociology", "urbanism", "education", "media"] },
  { id: "humanities", fields: ["philosophy", "history", "literature", "linguistics", "religion", "indigenous_studies"] },
  { id: "arts", fields: ["art", "music_film"] },
  { id: "science", fields: ["psychology", "biology", "medicine", "physics", "chemistry", "mathematics", "computer_science", "engineering", "environment"] },
] as const satisfies readonly { id: string; fields: readonly Field[] }[];
export type FieldGroupId = (typeof FIELD_GROUPS)[number]["id"];

/** Fewer answers than this could point to individuals, so city-wide totals stay hidden. */
export const LEAN_MIN_ANSWERS = 10;

/** A count of one or two meetups reads as discouraging, so the number only shows once it says something. */
export const MEETUPS_HELD_MIN_SHOWN = 5;

/** Answers from fewer people than this could point to one meetup's group, so the topic's totals stay hidden. */
export const OUTCOME_MIN_ANSWERS = 5;
export const TAKEAWAY_MAX_LENGTH = 200;
export const MIND_CHANGED = ["mine", "other", "no"] as const;
export type MindChanged = (typeof MIND_CHANGED)[number];
export const ENDED_UP = ["agreed", "split", "disagreed"] as const;
export type EndedUp = (typeof ENDED_UP)[number];
export const MEET_AGAIN = ["yes", "maybe", "no"] as const;
export type MeetAgain = (typeof MEET_AGAIN)[number];

export const STANCES = ["for", "against", "unsure"] as const;
export type Stance = (typeof STANCES)[number];

export const VENUE_KINDS = ["cafe", "library", "campus", "park", "other"] as const;
export type VenueKind = (typeof VENUE_KINDS)[number];

export const VENUE_LABELS: Record<VenueKind, string> = {
  cafe: "Café",
  library: "Library",
  campus: "Campus",
  park: "Park",
  other: "Somewhere else",
};

export const REPORT_REASONS = ["harassment", "spam", "fake_profile", "underage", "intimate_images", "safety", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Bump this when the terms or policy change enough that people must agree again. */
export const LEGAL_VERSION = "2026-11-07";
