import type { Me } from "@babillard/shared";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, friendlyError } from "@/api";
import { useAuth } from "@/auth";
import { TermsAgreement } from "@/components/TermsAgreement";
import { Button, ErrorText, T } from "@/ui";
import { t } from "@/i18n";

/** Shown to existing members when the terms or policy change enough to need their agreement again. */
export default function Agree() {
  const { setMe, signOut } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      setMe(await api.post<Me>("/me/accept-terms"));
    } catch (caught) {
      setError(friendlyError(caught));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <T variant="title">{t("Our terms have changed", "Nos conditions ont changé")}</T>
        <TermsAgreement agreed={agreed} onChange={setAgreed} />
        {error ? <ErrorText>{error}</ErrorText> : null}
      </View>
      <View style={styles.actions}>
        <Button label={t("Continue", "Continuer")} onPress={accept} busy={busy} disabled={!agreed} />
        <Button label={t("Sign out", "Se déconnecter")} kind="quiet" onPress={signOut} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, padding: 24, gap: 20, justifyContent: "center" },
  actions: { paddingHorizontal: 24, paddingBottom: 8, gap: 4 },
});
