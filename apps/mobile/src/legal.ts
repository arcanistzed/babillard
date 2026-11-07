import { Linking } from "react-native";
import { BASE_URL } from "./api";

type LegalPage = "privacy" | "terms" | "safety";

const PATHS: Record<LegalPage, { en: string; fr: string }> = {
  privacy: { en: "/privacy", fr: "/confidentialite" },
  terms: { en: "/terms", fr: "/conditions" },
  safety: { en: "/safety", fr: "/securite" },
};

/** The app's screens are English, but the legal pages follow the phone's language. */
export function openLegalPage(page: LegalPage): void {
  const language = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("fr") ? "fr" : "en";
  void Linking.openURL(`${BASE_URL}${PATHS[page][language]}`);
}
