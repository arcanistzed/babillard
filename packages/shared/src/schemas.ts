import { z } from "zod";
import { FIELDS, LOOKING_FOR, REPORT_REASONS, ROLES, STANCES, VENUE_KINDS } from "./constants";

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
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cityId: z.string().min(1),
  campusId: z.string().min(1).nullable().default(null),
});

export const topicSwipeSchema = z.object({
  direction: z.enum(["right", "left"]),
  stance: z.enum(STANCES).nullable().default(null),
});

export const peopleSwipeSchema = z.object({ direction: z.enum(["right", "left"]) });

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
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

export const reportSchema = z.object({
  targetUserId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(1000).default(""),
});

export const topicSubmissionSchema = z.object({
  kind: z.enum(["interest", "question"]),
  title: z.string().trim().min(4).max(120),
  blurb: z.string().trim().max(400).default(""),
  fieldTags: z.array(z.enum(FIELDS)).min(1).max(4),
});

export const pushTokenSchema = z.object({
  token: z.string().min(10).max(200),
  platform: z.enum(["ios", "android"]),
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type MeetupProposal = z.infer<typeof meetupProposalSchema>;
export type TopicSubmission = z.infer<typeof topicSubmissionSchema>;
