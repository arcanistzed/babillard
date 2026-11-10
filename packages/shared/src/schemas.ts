import { z } from "zod";
import { ENDED_UP, FIELDS, LOOKING_FOR, MEET_AGAIN, MIND_CHANGED, REPORT_REASONS, ROLES, STANCES, TAKEAWAY_MAX_LENGTH, VENUE_KINDS } from "./constants";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const authStartSchema = z.object({ email: emailSchema });

export const authVerifySchema = z.union([
  z.object({ token: z.string().min(20).max(200) }),
  z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) }),
]);

export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(50),
  bio: z.string().trim().max(500).default(""),
  role: z.enum(ROLES),
  fields: z.array(z.enum(FIELDS)).min(1).max(8),
  lookingFor: z.array(z.enum(LOOKING_FOR)).min(1),
});

export const onboardingSchema = profileSchema.extend({
  acceptedTerms: z.literal(true),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cityId: z.string().min(1),
  campusId: z.string().min(1).nullable().default(null),
});

export const locationSchema = z.object({
  cityId: z.string().min(1),
  campusId: z.string().min(1).nullable().default(null),
});

export const profileSaveSchema = profileSchema.extend({
  cityId: z.string().min(1).optional(),
  campusId: z.string().min(1).nullable().optional(),
});

export const topicSwipeSchema = z.object({
  direction: z.enum(["right", "left"]),
  stance: z.enum(STANCES).nullable().default(null),
});

export const peopleSwipeSchema = z.object({ direction: z.enum(["right", "left"]) });

const publicKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const encodedSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const deviceKeySchema = z.object({ publicKey: publicKeySchema });

/** 4,000 characters of the longest UTF-8, base64 encoded, and 8 members with 5 devices each. */
export const envelopeSchema = z.object({
  v: z.literal(1),
  from: publicKeySchema,
  nonce: encodedSchema.max(40),
  ciphertext: encodedSchema.max(22000),
  keys: z
    .record(publicKeySchema, z.object({ nonce: encodedSchema.max(40), key: encodedSchema.max(80) }))
    .refine((keys) => Object.keys(keys).length <= 40),
});

export const sendMessageSchema = z.object({
  envelope: envelopeSchema,
  clientId: z.string().max(64).optional(),
});

export const meetupProposalSchema = z
  .object({
    startsAt: z.number().int().positive(),
    endsAt: z.number().int().positive(),
    venueKind: z.enum(VENUE_KINDS),
    venueNote: z.string().trim().max(200).default(""),
  })
  .refine((value) => value.endsAt > value.startsAt, { message: "endsAt must be after startsAt", path: ["endsAt"] });

export const meetupResponseSchema = z.object({ response: z.enum(["yes", "no", "maybe"]) });
export const didMeetSchema = z.object({ didMeet: z.boolean() });

export const meetupOutcomeSchema = z.object({
  mindChanged: z.enum(MIND_CHANGED),
  endedUp: z.enum(ENDED_UP),
  meetAgain: z.enum(MEET_AGAIN),
  takeaway: z.string().trim().max(TAKEAWAY_MAX_LENGTH).default(""),
});

export const reportSchema = z.object({
  targetUserId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(1000).default(""),
  /** Message keys from the reporter's phone. The server checks each against the stored message. */
  evidence: z.array(z.object({ messageId: z.string().min(1).max(64), contentKey: encodedSchema.max(60) })).max(20).default([]),
});

export const topicSubmissionSchema = z.object({
  kind: z.enum(["interest", "question"]),
  title: z.string().trim().min(4).max(120),
  blurb: z.string().trim().max(400).default(""),
  fieldTags: z.array(z.enum(FIELDS)).min(1).max(4),
});

/** The draft someone wants help wording. Only the topic text, nothing about the person. */
export const wordingRequestSchema = z.object({
  kind: z.enum(["interest", "question"]),
  title: z.string().trim().min(4).max(120),
  blurb: z.string().trim().max(400).default(""),
});

export const clientErrorSchema = z.object({
  message: z.string().max(1000),
  stack: z.string().max(8000).default(""),
  fatal: z.boolean().default(false),
  platform: z.string().max(20).default(""),
  appVersion: z.string().max(40).default(""),
});

export const pushTokenSchema = z.object({
  token: z.string().min(10).max(200),
  platform: z.enum(["ios", "android"]),
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type MeetupProposal = z.infer<typeof meetupProposalSchema>;
export type TopicSubmission = z.infer<typeof topicSubmissionSchema>;
