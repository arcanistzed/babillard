import type { AppVersionInfo } from "@babillard/shared";
import * as Application from "expo-application";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, Platform, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { BASE_URL } from "@/api";
import { t } from "@/i18n";
import { useTheme } from "@/theme";
import { Button, T } from "@/ui";

/** Check again when the app comes back to the foreground, but not more than this often. */
const RECHECK_MS = 60 * 60 * 1000;

export type UpdateState = { kind: "current" } | { kind: "available" | "required"; url: string };

/**
 * Set on the Google Play build. Play's policy forbids an app from updating itself any other way, so
 * that build never offers the download from babillard.app, and a build too old to work sends people to Play.
 */
const FROM_PLAY = process.env.EXPO_PUBLIC_DISTRIBUTION === "play";
const PLAY_URL = "https://play.google.com/store/apps/details?id=com.babillard";

/**
 * The Android app installed from babillard.app has no store to update it. The server says which build is newest and which is the oldest that still works,
 * and the app compares those with its own build number.
 */
export function useAppUpdate(): UpdateState {
  const [state, setState] = useState<UpdateState>({ kind: "current" });

  const check = useCallback(async () => {
    const installed = Number.parseInt(Application.nativeBuildVersion ?? "", 10);
    if (Platform.OS !== "android" || !Number.isFinite(installed)) return;
    try {
      const response = await fetch(`${BASE_URL}/app/version`);
      if (!response.ok) return;
      const { android } = (await response.json()) as AppVersionInfo;
      if (installed < android.minimum) setState({ kind: "required", url: FROM_PLAY ? PLAY_URL : android.url });
      else if (installed < android.latest && !FROM_PLAY) setState({ kind: "available", url: android.url });
      else setState({ kind: "current" });
    } catch {
      // Offline or the server is down. The app keeps working with what it has.
    }
  }, []);

  useEffect(() => {
    let last = 0;
    const maybeCheck = () => {
      if (Date.now() - last < RECHECK_MS) return;
      last = Date.now();
      void check();
    };
    maybeCheck();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") maybeCheck();
    });
    return () => subscription.remove();
  }, [check]);

  return state;
}

const download = (url: string) => void Linking.openURL(url);

/** Replaces the whole app when this build is too old to work with the server. */
export function UpdateRequired({ url }: { url: string }) {
  const theme = useTheme();
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return (
    <SafeAreaView style={[styles.required, { backgroundColor: theme.paper }]}>
      <View style={styles.requiredCopy}>
        <T variant="display">{t("Time to update", "Il est temps de mettre à jour")}</T>
        <T>
          {FROM_PLAY
            ? t("This version no longer works. Update it from Google Play.", "Cette version ne fonctionne plus. Mettez-la à jour depuis Google Play.")
            : t(
                "This version no longer works. Download the new one and open the file to install it.",
                "Cette version ne fonctionne plus. Téléchargez la nouvelle et ouvrez le fichier pour l'installer.",
              )}
        </T>
      </View>
      <Button
        label={FROM_PLAY ? t("Open Google Play", "Ouvrir Google Play") : t("Download the update", "Télécharger la mise à jour")}
        onPress={() => download(url)}
      />
    </SafeAreaView>
  );
}

/** Offers an optional update once per launch, without getting in the way. */
export function useUpdateOffer(state: UpdateState) {
  const offered = useRef(false);
  useEffect(() => {
    if (state.kind !== "available" || offered.current) return;
    offered.current = true;
    Alert.alert(t("A new version is ready", "Une nouvelle version est prête"), t("Download it, then open the file to install it.", "Téléchargez-la, puis ouvrez le fichier pour l'installer."), [
      { text: t("Not now", "Plus tard"), style: "cancel" },
      { text: t("Download", "Télécharger"), onPress: () => download(state.url) },
    ]);
  }, [state]);
}

const styles = StyleSheet.create({
  required: { flex: 1, padding: 24, justifyContent: "space-between" },
  requiredCopy: { flex: 1, justifyContent: "center", gap: 16 },
});
