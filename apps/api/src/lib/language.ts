import { VENUE_LABELS, type VenueKind } from "@ideas-match/shared";
import type { Context } from "hono";

export type Language = "en" | "fr";

export function requestLanguage(c: Context): Language {
  return c.req.header("accept-language")?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

interface TranslatableTopic {
  title: string;
  blurb: string;
  openers: string[];
  fr?: { title: string; blurb: string; openers: string[] } | null;
}

/** Topics people suggest have no French version, so they show as written. */
export function localizeTopic(topic: TranslatableTopic, language: Language): { title: string; blurb: string; openers: string[] } {
  return language === "fr" && topic.fr ? topic.fr : { title: topic.title, blurb: topic.blurb, openers: topic.openers };
}

const VENUE_LABELS_FR: Record<VenueKind, string> = { cafe: "Café", library: "Bibliothèque", campus: "Campus", park: "Parc", other: "Ailleurs" };

export function venueNames(meetup: { venueKind: VenueKind; venueNote: string }): { en: string; fr: string } {
  return { en: meetup.venueNote || VENUE_LABELS[meetup.venueKind], fr: meetup.venueNote || VENUE_LABELS_FR[meetup.venueKind] };
}
