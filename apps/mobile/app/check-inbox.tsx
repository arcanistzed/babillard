import type { Me } from "@babillard/shared";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { useAuth } from "@/auth";
import { Button, ErrorText, Field, T, KeyboardScreen } from "@/ui";
import { t } from "@/i18n";

export default function CheckInbox() {
  const { email, devCode } = useLocalSearchParams<{ email: string; devCode?: string }>();
  const { completeSignIn } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify(value: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ token: string; me: Me }>("/auth/verify", { email, code: value });
      await completeSignIn(result.token, result.me);
    } catch (caught) {
      setError(friendlyError(caught));
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      await api.post("/auth/start", { email });
      setNotice(t("We sent you another email.", "Nous vous avons envoyé un autre courriel."));
    } catch (caught) {
      setError(friendlyError(caught));
    }
  }

  return (
    <KeyboardScreen style={styles.body}>
      <View style={styles.copy}>
        <T variant="title">{t("Check your email", "Vérifiez vos courriels")}</T>
        <T muted>{t(`We sent a code to ${email}.`, `Nous avons envoyé un code à ${email}.`)}</T>
        <T muted>{t("Not there? Check junk and quarantine.", "Rien reçu? Vérifiez les courriels indésirables et la quarantaine.")}</T>
      </View>
      <Field
        label={t("Six-digit code", "Code à six chiffres")}
        value={code}
        onChangeText={(value) => {
          const digits = value.replace(/\D/g, "").slice(0, 6);
          setCode(digits);
          if (digits.length === 6) void verify(digits);
        }}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoFocus
        maxLength={6}
        style={styles.codeInput}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {notice ? <T muted>{notice}</T> : null}
      <Button label={t("Sign in", "Se connecter")} onPress={() => verify(code)} busy={busy} disabled={code.length !== 6} />
      <Button label={t("Send another email", "Envoyer un autre courriel")} kind="quiet" onPress={resend} />
      {__DEV__ && devCode ? (
        <T variant="small" muted>
          Development build. Your code is {devCode}.
        </T>
      ) : null}
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: 24, gap: 16 },
  copy: { gap: 8 },
  codeInput: { fontSize: 26, letterSpacing: 8, textAlign: "center" },
});
