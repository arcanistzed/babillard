import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, friendlyError } from "@/api";
import { FlyerStack } from "@/components/FlyerStack";
import { Button, ErrorText, Field, T, KeyboardScreen, useKeyboardOpen } from "@/ui";
import { t } from "@/i18n";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const { height, fontScale } = useWindowDimensions();
  const keyboardOpen = useKeyboardOpen();
  // The picture only goes where there is space to spare for it.
  const roomForPicture = !keyboardOpen && height >= 700 && fontScale <= 1.2;
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
          {roomForPicture ? <FlyerStack /> : null}
          <T variant="heading" accessibilityRole="text">
            Babillard
          </T>
          <T variant="display">{t("Find people who want to talk about the same things.", "Trouvez des gens qui veulent parler des mêmes choses.")}</T>
          <T muted>{t("Pick topics, match with people in your city, and meet in person.", "Choisissez des sujets, trouvez des gens de votre ville et rencontrez-les en personne.")}</T>
        </View>
        <View style={styles.form}>
          <Field
            label={t("Your email", "Votre courriel")}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder={t("you@example.com", "vous@exemple.com")}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button label={t("Email me a code", "M'envoyer un code")} onPress={submit} busy={busy} disabled={!email.includes("@")} />
          <T variant="small" muted>
            {t("Any email works. School emails get a verified badge.", "Tout courriel convient. Les courriels scolaires obtiennent un badge vérifié.")}
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
