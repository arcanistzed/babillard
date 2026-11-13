import type { Envelope, ReportEvidence } from "@babillard/shared";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { EndedUp, Field, LookingFor, MeetAgain, MindChanged, Role, Stance, VenueKind } from "@babillard/shared";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    dob: text("dob"),
    verifiedInstitution: integer("verified_institution", { mode: "boolean" }).notNull().default(false),
    institutionDomain: text("institution_domain"),
    cityId: text("city_id"),
    campusId: text("campus_id"),
    status: text("status", { enum: ["active", "banned", "deleted"] }).notNull().default("active"),
    onboardedAt: integer("onboarded_at"),
    /** Picks the language of push notifications and emails. The app sets it from the phone's language. */
    language: text("language", { enum: ["en", "fr"] }).notNull().default("en"),
    termsVersion: text("terms_version"),
    termsAcceptedAt: integer("terms_accepted_at"),
    /** Updated at most daily. Accounts unused for two years are removed. */
    lastActiveAt: integer("last_active_at"),
    inactivityWarnedAt: integer("inactivity_warned_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("users_city_idx").on(t.cityId, t.status), index("users_activity_idx").on(t.status, t.lastActiveAt)],
);

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  bio: text("bio").notNull().default(""),
  avatarKey: text("avatar_key"),
  role: text("role").$type<Role>().notNull(),
  fields: text("fields", { mode: "json" }).$type<Field[]>().notNull(),
  lookingFor: text("looking_for", { mode: "json" }).$type<LookingFor[]>().notNull(),
  /** The ages this person wants to meet. Null means no limit at that end. */
  ageMin: integer("age_min"),
  ageMax: integer("age_max"),
});

export const localities = sqliteTable("localities", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["city", "campus"] }).notNull(),
  parentId: text("parent_id"),
  region: text("region").notNull().default(""),
  country: text("country").notNull().default(""),
  countryCode: text("country_code").notNull().default(""),
  population: integer("population").notNull().default(0),
  aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull().default([]),
  latitude: real("latitude").notNull().default(0),
  longitude: real("longitude").notNull().default(0),
});

export const topics = sqliteTable(
  "topics",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["interest", "question"] }).notNull(),
    title: text("title").notNull(),
    blurb: text("blurb").notNull().default(""),
    fieldTags: text("field_tags", { mode: "json" }).$type<string[]>().notNull(),
    openers: text("openers", { mode: "json" }).$type<string[]>().notNull(),
    /** Seeded topics have a French version. Topics people suggest don't. */
    fr: text("fr", { mode: "json" }).$type<{ title: string; blurb: string; openers: string[] }>(),
    status: text("status", { enum: ["seeded", "pending", "approved", "rejected", "retired"] }).notNull(),
    /**
     * Where the topic appears: null for everywhere, a country code ("CA"), a country and
     * region ("CA:Ontario"), or a locality ID. Suggested topics stay in the suggester's city.
     */
    place: text("place"),
    /** Seeded topics new people see first, in this order, so early arrivals overlap. */
    starter: integer("starter"),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("topics_status_idx").on(t.status)],
);

export const topicSwipes = sqliteTable(
  "topic_swipes",
  {
    userId: text("user_id").notNull(),
    topicId: text("topic_id").notNull(),
    direction: text("direction", { enum: ["right", "left"] }).notNull(),
    stance: text("stance").$type<Stance>(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.topicId] }), index("topic_swipes_topic_idx").on(t.topicId, t.direction)],
);

export const peopleSwipes = sqliteTable(
  "people_swipes",
  {
    fromUser: text("from_user").notNull(),
    toUser: text("to_user").notNull(),
    direction: text("direction", { enum: ["right", "left"] }).notNull(),
    viaTopicId: text("via_topic_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.fromUser, t.toUser] })],
);

export const matches = sqliteTable(
  "matches",
  {
    id: text("id").primaryKey(),
    userA: text("user_a").notNull(),
    userB: text("user_b").notNull(),
    topicId: text("topic_id"),
    conversationId: text("conversation_id").notNull(),
    state: text("state", { enum: ["active", "expired", "closed"] }).notNull().default("active"),
    expiresAt: integer("expires_at").notNull(),
    nudgedAt: integer("nudged_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("matches_pair_idx").on(t.userA, t.userB),
    index("matches_conversation_idx").on(t.conversationId),
    index("matches_sweep_idx").on(t.state, t.createdAt),
  ],
);

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["direct", "group"] }).notNull(),
  topicId: text("topic_id"),
  localityId: text("locality_id"),
  lastMessagePreview: text("last_message_preview"),
  lastMessagePreviewFr: text("last_message_preview_fr"),
  lastMessageEnvelope: text("last_message_envelope", { mode: "json" }).$type<Envelope>(),
  lastMessageSenderId: text("last_message_sender_id"),
  lastMessageAt: integer("last_message_at"),
  lastUserMessageAt: integer("last_user_message_at"),
  createdAt: integer("created_at").notNull(),
});

export const conversationMembers = sqliteTable(
  "conversation_members",
  {
    conversationId: text("conversation_id").notNull(),
    userId: text("user_id").notNull(),
    joinedAt: integer("joined_at").notNull(),
    lastReadAt: integer("last_read_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    muted: integer("muted", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index("members_user_idx").on(t.userId)],
);

export const meetups = sqliteTable(
  "meetups",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    proposedBy: text("proposed_by").notNull(),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    venueKind: text("venue_kind").$type<VenueKind>().notNull(),
    venueNote: text("venue_note").notNull().default(""),
    state: text("state", { enum: ["proposed", "confirmed", "cancelled", "done"] }).notNull().default("proposed"),
    shareToken: text("share_token").notNull().unique(),
    reminderSentAt: integer("reminder_sent_at"),
    checkinSentAt: integer("checkin_sent_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("meetups_conversation_idx").on(t.conversationId), index("meetups_sweep_idx").on(t.state, t.startsAt)],
);

export const meetupResponses = sqliteTable(
  "meetup_responses",
  {
    meetupId: text("meetup_id").notNull(),
    userId: text("user_id").notNull(),
    response: text("response", { enum: ["yes", "no", "maybe"] }).notNull(),
    didMeet: integer("did_meet", { mode: "boolean" }),
    respondedAt: integer("responded_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.meetupId, t.userId] })],
);

/**
 * What each attendee reported after a meetup they confirmed. Answers feed per-topic percentages.
 * The optional takeaway line is plain text, not end-to-end encrypted: a moderator reads it, and an approved one appears on the topic page without a name.
 */
export const meetupOutcomes = sqliteTable(
  "meetup_outcomes",
  {
    meetupId: text("meetup_id").notNull(),
    userId: text("user_id").notNull(),
    mindChanged: text("mind_changed").$type<MindChanged>().notNull(),
    endedUp: text("ended_up").$type<EndedUp>().notNull(),
    meetAgain: text("meet_again").$type<MeetAgain>().notNull(),
    takeaway: text("takeaway"),
    takeawayStatus: text("takeaway_status", { enum: ["pending", "approved", "rejected"] }),
    language: text("language", { enum: ["en", "fr"] }).notNull().default("en"),
    createdAt: integer("created_at").notNull(),
    reviewedAt: integer("reviewed_at"),
  },
  (t) => [primaryKey({ columns: [t.meetupId, t.userId] }), index("meetup_outcomes_takeaway_idx").on(t.takeawayStatus, t.createdAt)],
);

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id").notNull(),
    targetUserId: text("target_user_id").notNull(),
    conversationId: text("conversation_id"),
    messageId: text("message_id"),
    reason: text("reason").notNull(),
    note: text("note").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
    action: text("action", { enum: ["resolved", "warned", "banned"] }),
    /** Messages the reporter chose to reveal, each checked against the stored ciphertext. */
    evidence: text("evidence", { mode: "json" }).$type<ReportEvidence[]>(),
  },
  (t) => [index("reports_open_idx").on(t.resolvedAt, t.createdAt)],
);

export const blocks = sqliteTable(
  "blocks",
  {
    blockerId: text("blocker_id").notNull(),
    blockedId: text("blocked_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index("blocks_blocked_idx").on(t.blockedId)],
);

export const pushTokens = sqliteTable(
  "push_tokens",
  {
    token: text("token").primaryKey(),
    userId: text("user_id").notNull(),
    platform: text("platform", { enum: ["ios", "android"] }).notNull(),
  },
  (t) => [index("push_tokens_user_idx").on(t.userId)],
);

/** `id` is the SHA-256 of the bearer token, so a database leak does not leak live sessions. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const magicLinks = sqliteTable(
  "magic_links",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("magic_links_email_idx").on(t.email, t.createdAt), index("magic_links_created_idx").on(t.createdAt)],
);

/** What moderators did, and who did it. Rows are never updated or removed. */
export const moderationLog = sqliteTable(
  "moderation_log",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type", { enum: ["report", "user", "topic", "takeaway"] }).notNull(),
    targetId: text("target_id").notNull(),
    detail: text("detail").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("moderation_log_created_idx").on(t.createdAt), index("moderation_log_target_idx").on(t.targetType, t.targetId)],
);

/** JavaScript crashes reported by the app. Holds no user ID, and the cron sweep removes rows after 30 days. */
export const clientErrors = sqliteTable(
  "client_errors",
  {
    id: text("id").primaryKey(),
    message: text("message").notNull(),
    stack: text("stack").notNull().default(""),
    fatal: integer("fatal", { mode: "boolean" }).notNull().default(false),
    platform: text("platform").notNull().default(""),
    appVersion: text("app_version").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("client_errors_created_idx").on(t.createdAt)],
);

/** A phone's public key. The private half never leaves the phone. */
export const deviceKeys = sqliteTable(
  "device_keys",
  {
    publicKey: text("public_key").primaryKey(),
    userId: text("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
    /** Retired keys get no new messages, but stay known so older messages can still be attributed. */
    retiredAt: integer("retired_at"),
  },
  (t) => [index("device_keys_user_idx").on(t.userId)],
);
