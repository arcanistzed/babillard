import { Linking } from "react-native";
import { BASE_URL } from "./api";
import { languageTag } from "./i18n";

type LegalPage = "privacy" | "terms" | "safety";

const PATHS: Record<LegalPage, { en: string; fr: string }> = {
  privacy: { en: "/privacy", fr: "/confidentialite" },
  terms: { en: "/terms", fr: "/conditions" },
  safety: { en: "/safety", fr: "/securite" },
};

export function openLegalPage(page: LegalPage): void {
  void Linking.openURL(`${BASE_URL}${PATHS[page][languageTag]}`);
}
