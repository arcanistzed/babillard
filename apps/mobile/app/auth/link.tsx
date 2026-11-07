import type { Me } from "@ideas-match/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { useAuth } from "@/auth";
import { Button, ErrorText, T } from "@/ui";
import { t } from "@/i18n";

/** Where the emailed link lands, whether through a Universal Link, an App Link, or the custom scheme. */
export default function AuthLink() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { completeSignIn, me } = useAuth();
  const [error, setError] = useState<string | null>(token ? null: t("This link is missing its sign-in details.", "Il manque les renseignements de connexion à ce lien."));
  const started = useRef(false);

  useEffect(() => {
    // Already signed in, perhaps from tapping an old email. The route guard takes it from here.
    if (me || !token || started.current) return;
    started.current = true;
    api
      .post<{ token: string; me: Me }>("/auth/verify", { token })
      .then((result) => completeSignIn(result.token, result.me))
      .catch((caught) => setError(friendlyError(caught)));
  }, [completeSignIn, me, token]);

  return (
    <View style={styles.screen}>
      {error ? (
        <>
          <T variant="title">{t("That link didn't work", "Ce lien n'a pas fonctionné")}</T>
          <ErrorText>{error}</ErrorText>
          <Button label={t("Get a new code", "Obtenir un nouveau code")} onPress={() => router.replace("/sign-in")} />
        </>
      ) : (
        <ActivityIndicator accessibilityLabel={t("Signing you in", "Connexion en cours")} size="large" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16, justifyContent: "center" },
});
