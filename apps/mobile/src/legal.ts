import { SOURCE_URL } from "@babillard/shared";
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

/**
 * Opens over the app, so closing it returns to the same screen, mid sign-up included. The page has to open
 * in the app's own task: in a task of its own (the library's default), closing it lands on the home screen.
 */
export function openLegalPage(page: LegalPage): void {
  openInApp(`${BASE_URL}${PATHS[page][languageTag]}`);
}

/** The AGPL requires offering the source to everyone who uses the app. */
export function openSourceCode(): void {
  openInApp(SOURCE_URL);
}

function openInApp(url: string): void {
  void WebBrowser.openBrowserAsync(url, { createTask: false }).catch(() => Linking.openURL(url));
}
