import * as WebBrowser from "expo-web-browser";
import { Linking } from "react-native";
import { BASE_URL } from "./api";
import { languageTag } from "./i18n";

type LegalPage = "privacy" | "terms" | "safety";

const PATHS: Record<LegalPage, { en: string; fr: string }> = {
  privacy: { en: "/privacy", fr: "/confidentialite" },
  terms: { en: "/terms", fr: "/conditions" },
  safety: { en: "/safety", fr: "/securite" },
};

/** Opens over the app, so closing it returns to the same screen, mid sign-up included. */
export function openLegalPage(page: LegalPage): void {
  const url = `${BASE_URL}${PATHS[page][languageTag]}`;
  void WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url));
}
