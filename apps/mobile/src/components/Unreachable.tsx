import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/auth";
import { t } from "@/i18n";
import { useTheme } from "@/theme";
import { Button, T } from "@/ui";

/** Shown over everything while a saved session can't be checked. The app keeps retrying on its own. */
export function Unreachable() {
  const theme = useTheme();
  const { retry } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <SafeAreaView style={[StyleSheet.absoluteFill, { backgroundColor: theme.paper }]}>
      <View style={styles.body} accessibilityLiveRegion="polite">
        <T variant="title">{t("Can't reach Babillard", "Impossible de joindre Babillard")}</T>
        <T muted>{t("You're still signed in. Check your connection.", "Vous êtes toujours connecté. Vérifiez votre connexion.")}</T>
        <Button
          label={t("Try again", "Réessayer")}
          busy={busy}
          onPress={async () => {
            setBusy(true);
            await retry();
            setBusy(false);
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: 24, gap: 16, justifyContent: "center" },
});
