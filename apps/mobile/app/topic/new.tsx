import type { Field as FieldName, WordingSuggestion } from "@babillard/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { Button, Chip, ChipRow, ErrorText, Field, FormScreen, T } from "@/ui";
import { FieldPicker } from "@/components/FieldPicker";
import { t } from "@/i18n";
import { useTheme } from "@/theme";

export default function NewTopic() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"interest" | "question">("interest");
  const [title, setTitle] = useState("");
  const [blurb, setBlurb] = useState("");
  const [fieldTags, setFieldTags] = useState<FieldName[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<WordingSuggestion | null>(null);
  const [wordingBusy, setWordingBusy] = useState(false);
  const [wordingError, setWordingError] = useState<string | null>(null);
  const theme = useTheme();

  async function suggestWording() {
    setWordingBusy(true);
    setWordingError(null);
    setSuggestion(null);
    try {
      setSuggestion(await api.post<WordingSuggestion>("/deck/topics/wording", { kind, title: title.trim(), blurb: blurb.trim() }));
    } catch (caught) {
      setWordingError(friendlyError(caught));
    } finally {
      setWordingBusy(false);
    }
  }

  function applySuggestion() {
    if (!suggestion) return;
    setTitle(suggestion.title);
    setBlurb(suggestion.blurb);
    setSuggestion(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/deck/topics", { kind, title: title.trim(), blurb: blurb.trim(), fieldTags });
      await queryClient.invalidateQueries({ queryKey: ["topics"] });
      router.back();
    } catch (caught) {
      setError(friendlyError(caught));
      setBusy(false);
    }
  }

  return (
    <FormScreen>
        <ChipRow>
          <Chip label={t("An interest", "Un intérêt")} selected={kind === "interest"} onPress={() => setKind("interest")} />
          <Chip label={t("A question to debate", "Une question à débattre")} selected={kind === "question"} onPress={() => setKind("question")} />
        </ChipRow>
        <Field
          label={kind === "question" ? t("The question", "La question") : t("The topic", "Le sujet")}
          value={title}
          onChangeText={setTitle}
          maxLength={120}
          placeholder={kind === "question" ? t("Should jury duty pay a living wage?", "Les jurés devraient-ils toucher un salaire décent?") : t("The history of cartography", "L'histoire de la cartographie")}
        />
        <Field label={t("One line on why it's interesting (optional)", "Pourquoi c'est intéressant, en une ligne (facultatif)")} value={blurb} onChangeText={setBlurb} maxLength={400} multiline style={styles.blurb} />
        <Button label={t("Suggest clearer wording", "Suggérer une formulation plus claire")} kind="secondary" onPress={suggestWording} busy={wordingBusy} disabled={title.trim().length < 4} />
        {wordingError ? <T variant="small" muted>{wordingError}</T> : null}
        {suggestion ? (
          <View style={[styles.suggestion, { borderColor: theme.line, backgroundColor: theme.surface }]} accessibilityLiveRegion="polite">
            <T variant="small" muted>
              {t("A clearer version. Use it, edit it, or keep yours.", "Une version plus claire. Utilisez-la, modifiez-la ou gardez la vôtre.")}
            </T>
            <T variant="heading">{suggestion.title}</T>
            {suggestion.blurb ? <T>{suggestion.blurb}</T> : null}
            <Button label={t("Use this wording", "Utiliser cette formulation")} onPress={applySuggestion} />
            <Button label={t("Keep mine", "Garder la mienne")} kind="quiet" onPress={() => setSuggestion(null)} />
          </View>
        ) : null}
        <T variant="heading">{t("Which fields does it touch?", "Quels domaines touche-t-il?")}</T>
        <FieldPicker value={fieldTags} onChange={setFieldTags} max={4} />
        {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label={t("Suggest this topic", "Suggérer ce sujet")} onPress={submit} busy={busy} disabled={title.trim().length < 4 || fieldTags.length === 0} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  blurb: { minHeight: 72, textAlignVertical: "top" },
  suggestion: { gap: 10, padding: 16, borderWidth: 1, borderRadius: 12 },
});
