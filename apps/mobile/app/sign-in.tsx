import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, friendlyError } from "@/api";
import { Button, ErrorText, Field, T, KeyboardScreen } from "@/ui";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const trimmed = email.trim().toLowerCase();
      const result = await api.post<{ devCode?: string }>("/auth/start", { email: trimmed });
      router.push({ pathname: "/check-inbox", params: { email: trimmed, ...(result.devCode ? { devCode: result.devCode } : {}) } });
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardScreen style={styles.body}>
        <View style={styles.pitch}>
          <T variant="display">Find people who want to talk about the same things.</T>
          <T muted>Pick the ideas you care about, match with people in your city, and meet up in person.</T>
        </View>
        <View style={styles.form}>
          <Field
            label="Your email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@example.edu"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button label="Email me a code" onPress={submit} busy={busy} disabled={!email.includes("@")} />
          <T variant="small" muted>
            A school email adds a verified badge to your profile. Any email works.
          </T>
        </View>
      </KeyboardScreen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, padding: 24, justifyContent: "space-between", gap: 24 },
  pitch: { flex: 1, justifyContent: "center", gap: 14 },
  form: { gap: 12 },
});
