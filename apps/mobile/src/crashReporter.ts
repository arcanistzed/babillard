import Constants from "expo-constants";
import { Platform } from "react-native";
import { BASE_URL } from "./api";

const MAX_REPORTS_PER_RUN = 5;
let sent = 0;

/** Sends no identity. A crash loop stops after a few reports. Failure to report is ignored, since the app is already failing. */
export function reportCrash(error: unknown, fatal: boolean): void {
  if (sent >= MAX_REPORTS_PER_RUN) return;
  sent += 1;
  const { message, stack } = error instanceof Error ? error : { message: String(error), stack: "" };
  void fetch(`${BASE_URL}/client-errors`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: message.slice(0, 1000),
      stack: (stack ?? "").slice(0, 8000),
      fatal,
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version ?? "",
    }),
  }).catch(() => undefined);
}

export function installCrashReporter(): void {
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    reportCrash(error, !!isFatal);
    previous(error, isFatal);
  });
}
