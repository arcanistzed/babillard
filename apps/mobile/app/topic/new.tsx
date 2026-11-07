import { FIELDS, type Field as FieldName } from "@ideas-match/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet } from "react-native";
import { api, friendlyError } from "@/api";
import { Button, Chip, ChipRow, ErrorText, Field, FormScreen, T } from "@/ui";
import { fieldLabel, t } from "@/i18n";

export default function NewTopic() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"interest" | "question">("interest");
  const [title, setTitle] = useState("");
  const [blurb, setBlurb] = useState("");
  const [fieldTags, setFieldTags] = useState<FieldName[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <T variant="heading">{t("Which fields does it touch?", "Quels domaines touche-t-il?")}</T>
        <ChipRow>
          {FIELDS.map((field) => {
            const selected = fieldTags.includes(field);
            return (
              <Chip
                key={field}
                label={fieldLabel(field)}
                selected={selected}
                disabled={!selected && fieldTags.length >= 4}
                onPress={() => setFieldTags(selected ? fieldTags.filter((item) => item !== field) : [...fieldTags, field])}
              />
            );
          })}
        </ChipRow>
        {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label={t("Suggest this topic", "Suggérer ce sujet")} onPress={submit} busy={busy} disabled={title.trim().length < 4 || fieldTags.length === 0} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  blurb: { minHeight: 72, textAlignVertical: "top" },
});
