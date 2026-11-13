import type { Field, FieldGroupId, LookingFor, Role, VenueKind } from "@babillard/shared";
import { FIELD_LABELS, LOOKING_FOR_LABELS, ROLE_LABELS, VENUE_LABELS } from "@babillard/shared";

/** The app follows the phone's language: French if it's set to French, English otherwise. */
export const isFrench = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("fr");
export const languageTag = isFrench ? "fr" : "en";

export function t(english: string, french: string): string {
  return isFrench ? french : english;
}

const FIELD_LABELS_FR: Record<Field, string> = {
  economics: "Économie",
  politics: "Politique",
  law: "Droit",
  history: "Histoire",
  philosophy: "Philosophie",
  sociology: "Sociologie",
  psychology: "Psychologie",
  literature: "Littérature",
  linguistics: "Linguistique",
  art: "Art et design",
  biology: "Biologie",
  medicine: "Médecine et santé",
  physics: "Physique",
  chemistry: "Chimie",
  mathematics: "Mathématiques",
  computer_science: "Informatique",
  engineering: "Génie",
  environment: "Environnement et climat",
  education: "Éducation",
  urbanism: "Villes et urbanisme",
  business: "Affaires",
  media: "Médias et journalisme",
  public_policy: "Politiques publiques",
  religion: "Religion",
  indigenous_studies: "Études autochtones",
  music_film: "Musique et cinéma",
};

const LOOKING_FOR_LABELS_FR: Record<LookingFor, string> = {
  learning: "Apprendre",
  networking: "Réseautage",
  friends: "Amitié",
  more_than_friends: "Ouvert aux rencontres amoureuses",
  research: "Collaboration de recherche",
  reading_group: "Club de lecture",
  debate: "Débat",
};

const ROLE_LABELS_FR: Record<Role, string> = {
  undergrad: "Premier cycle",
  grad: "Cycles supérieurs",
  researcher: "Recherche",
  other: "Personne curieuse",
};

const VENUE_LABELS_FR: Record<VenueKind, string> = { cafe: "Café", library: "Bibliothèque", campus: "Campus", park: "Parc", other: "Ailleurs" };

const FIELD_GROUP_LABELS: Record<FieldGroupId, [string, string]> = {
  society: ["Society and public life", "Société et vie publique"],
  humanities: ["Humanities", "Sciences humaines"],
  arts: ["Arts", "Arts"],
  science: ["Science and technology", "Sciences et technologie"],
};
const SHORT_GROUP_LABELS: Record<FieldGroupId, [string, string]> = {
  society: ["Society", "Société"],
  humanities: ["Humanities", "Humanités"],
  arts: ["Arts", "Arts"],
  science: ["Science", "Sciences"],
};

export const fieldGroupLabel = (group: FieldGroupId) => FIELD_GROUP_LABELS[group][isFrench ? 1 : 0];
export const shortGroupLabel = (group: FieldGroupId) => SHORT_GROUP_LABELS[group][isFrench ? 1 : 0];
export const fieldLabel = (field: Field) => (isFrench ? FIELD_LABELS_FR[field] : FIELD_LABELS[field]);
export const lookingForLabel = (item: LookingFor) => (isFrench ? LOOKING_FOR_LABELS_FR[item] : LOOKING_FOR_LABELS[item]);
/** How a person's name shows to others, like "Dana, 24". */
export const nameWithAge = (name: string, age: number | null) => (age === null ? name : `${name}, ${age}`);
export const roleLabel = (role: Role) => (isFrench ? ROLE_LABELS_FR[role] : ROLE_LABELS[role]);
export const venueLabel = (venue: VenueKind) => (isFrench ? VENUE_LABELS_FR[venue] : VENUE_LABELS[venue]);

const SLOT_WORDS: Record<string, string> = {
  Sunday: "dimanche",
  Monday: "lundi",
  Tuesday: "mardi",
  Wednesday: "mercredi",
  Thursday: "jeudi",
  Friday: "vendredi",
  Saturday: "samedi",
  Tomorrow: "Demain",
  morning: "matin",
  afternoon: "après-midi",
  lunch: "midi",
  evening: "soir",
};
const SLOT_PHRASES: Record<string, string> = { "Lunch today": "Ce midi", "This morning": "Ce matin", "This afternoon": "Cet après-midi", "This evening": "Ce soir" };

/** Suggested meetup times come from shared rules in English, such as "Saturday morning". */
export function slotLabel(label: string): string {
  if (!isFrench) return label;
  const phrase = SLOT_PHRASES[label];
  if (phrase) return phrase;
  const words = label.split(" ").map((word) => SLOT_WORDS[word] ?? word).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "A", "A and B", or "A, B and C", in the app's language. */
export function listOf(items: string[]): string {
  const and = t(" and ", " et ");
  if (items.length <= 2) return items.join(and);
  return `${items.slice(0, -1).join(", ")}${and}${items[items.length - 1]}`;
}
