import type { Me } from "@ideas-match/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { useAuth } from "@/auth";
import { Button, ErrorText, T } from "@/ui";

/** Where the emailed link lands, whether through a Universal Link, an App Link, or the custom scheme. */
export default function AuthLink() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { completeSignIn, me } = useAuth();
  const [error, setError] = useState<string | null>(token ? null : "This link is missing its sign-in details.");
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
          <T variant="title">That link didn't work</T>
          <ErrorText>{error}</ErrorText>
          <Button label="Get a new code" onPress={() => router.replace("/sign-in")} />
        </>
      ) : (
        <ActivityIndicator accessibilityLabel="Signing you in" size="large" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16, justifyContent: "center" },
});
