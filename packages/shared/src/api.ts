import type { Field, LookingFor, Role, Stance, VenueKind } from "./constants";

/** Response shapes shared by the Worker and the app. */

export interface Me {
  id: string;
  email: string;
  verifiedInstitution: boolean;
  institutionDomain: string | null;
  onboarded: boolean;
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
  lastMessagePreview: string | null;
  lastMessageAt: number | null;
  unreadCount: number;
  expiresAt: number | null;
  nextMeetupAt: number | null;
}

export interface ConversationMember {
  id: string;
  displayName: string;
  avatarUrl: string | null;
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

export interface ChatMessage {
  /** Per-conversation order. Pass as `before` to page back through history. */
  seq: number;
  id: string;
  senderId: string | null;
  body: string;
  kind: "text" | "system" | "meetup";
  meetupId: string | null;
  createdAt: number;
  clientId?: string;
}

export type ServerSocketEvent =
  | { type: "message"; message: ChatMessage }
  | { type: "meetup"; meetup: { id: string } }
  | { type: "error"; error: string };

export interface ClientSocketEvent {
  type: "send";
  body: string;
  clientId?: string;
}

export interface PushData {
  screen: "chat" | "meetup";
  id: string;
}
