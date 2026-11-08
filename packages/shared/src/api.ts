import type { Envelope } from "./e2ee";
import type { Lean } from "./rules/match";
import type { EndedUp, Field, LookingFor, MeetAgain, MindChanged, Role, Stance, VenueKind } from "./constants";

/** Response shapes shared by the Worker and the app. */

export interface Me {
  id: string;
  email: string;
  verifiedInstitution: boolean;
  institutionDomain: string | null;
  onboarded: boolean;
  /** False when someone hasn't agreed to the current terms and privacy policy. */
  termsAccepted: boolean;
  cityId: string | null;
  campusId: string | null;
  profile: {
    displayName: string;
    bio: string;
    role: Role;
    fields: Field[];
    lookingFor: LookingFor[];
    avatarUrl: string | null;
  } | null;
}

export interface Locality {
  id: string;
  slug: string;
  name: string;
  kind: "city" | "campus";
  parentId: string | null;
  region: string;
  country: string;
  countryCode: string;
  population: number;
  /** Suburbs and neighbouring towns that share this city's cohort. */
  aliases: string[];
  latitude: number;
  longitude: number;
}

export interface TopicCard {
  id: string;
  kind: "interest" | "question";
  title: string;
  blurb: string;
  fieldTags: string[];
  nearbyCount: number;
  pending: boolean;
  /** Percentages for this city. Null until enough people have answered and they don't all agree. */
  lean: Lean | null;
  /** Meetups on this topic that someone confirmed really happened. Null until there are enough to be worth showing. */
  meetupsHeld: number | null;
  /** What people reported after meetups on this topic. Null until enough of them have answered. */
  outcomes: TopicOutcomes | null;
}

/** Percentages of answers, so no single meetup can be picked out. */
export interface TopicOutcomes {
  answers: number;
  /** Said their own or someone else's mind changed. */
  mindChanged: number;
  agreed: number;
  split: number;
  disagreed: number;
  meetAgain: number;
}

export interface MyOutcome {
  mindChanged: MindChanged;
  endedUp: EndedUp;
  meetAgain: MeetAgain;
  takeaway: string;
}

export interface TopicSwipeResult {
  groupConversationId: string | null;
}

export interface PersonCard {
  id: string;
  displayName: string;
  bio: string;
  role: Role;
  avatarUrl: string | null;
  verifiedInstitution: boolean;
  campusName: string | null;
  fields: Field[];
  lookingFor: LookingFor[];
  sharedTopics: { id: string; title: string }[];
}

export interface PeopleSwipeResult {
  matched: boolean;
  conversationId: string | null;
}

export interface InboxItem {
  id: string;
  kind: "direct" | "group";
  title: string;
  topicTitle: string | null;
  avatarUrl: string | null;
  memberCount: number;
  /** Only ever set for messages the app wrote itself. People's messages arrive in lastMessageEnvelope. */
  lastMessagePreview: string | null;
  lastMessageEnvelope: Envelope | null;
  lastMessageSenderId: string | null;
  lastMessageAt: number | null;
  unreadCount: number;
  expiresAt: number | null;
  nextMeetupAt: number | null;
}

export interface ConversationMember {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** Devices that can read new messages. */
  deviceKeys: string[];
  retiredDeviceKeys: string[];
}

export interface MeetupSummary {
  id: string;
  conversationId: string;
  proposedBy: string;
  startsAt: number;
  endsAt: number;
  venueKind: VenueKind;
  venueNote: string;
  state: "proposed" | "confirmed" | "cancelled" | "done";
  yesCount: number;
  requiredYes: number;
  myResponse: "yes" | "no" | "maybe" | null;
  myDidMeet: boolean | null;
  /** Null until this person answers the questions that follow "Yes, we met". */
  myOutcome: MyOutcome | null;
  shareUrl: string;
  checkinOpen: boolean;
}

export interface ConversationDetail {
  id: string;
  kind: "direct" | "group";
  title: string;
  topic: { id: string; title: string; kind: "interest" | "question" } | null;
  members: ConversationMember[];
  /** Tap-to-send openers, offered until the first person writes something. */
  suggestedOpeners: string[];
  /** Aggregate only. Individual stances are never exposed. */
  stanceSpread: Record<Stance, number> | null;
  meetups: MeetupSummary[];
  expiresAt: number | null;
  muted: boolean;
}

export interface ReportEvidence {
  id: string;
  senderId: string;
  body: string;
  createdAt: number;
}

export interface ChatMessage {
  /** Per-conversation order. Pass as `before` to page back through history. */
  seq: number;
  id: string;
  senderId: string | null;
  /** Empty for people's messages, which are in `envelope`. Holds the text of messages the app wrote. */
  body: string;
  bodyFr?: string;
  envelope?: Envelope;
  kind: "text" | "system" | "meetup";
  meetupId: string | null;
  createdAt: number;
  clientId?: string;
}

export type ServerSocketEvent =
  | { type: "message"; message: ChatMessage }
  | { type: "meetup"; meetup: { id: string } }
  | { type: "error"; error: string; clientId?: string };

export interface ClientSocketEvent {
  type: "send";
  envelope: Envelope;
  clientId?: string;
}

export interface PushData {
  screen: "chat" | "meetup";
  id: string;
}
