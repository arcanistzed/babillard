export const GROUP_MIN_SIZE = 4;
export const GROUP_MAX_SIZE = 8;
export const GROUP_MEETUP_CONFIRM_YES = 3;
export const MIN_AGE_YEARS = 18;
export const DECK_PAGE_SIZE = 20;
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
  more_than_friends: "More than friends",
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
};

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

export const REPORT_REASONS = ["harassment", "spam", "fake_profile", "underage", "safety", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
