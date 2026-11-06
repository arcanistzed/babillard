import { FIELDS, FIELD_LABELS, type Field as FieldName } from "@ideas-match/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { Button, Chip, ChipRow, ErrorText, Field, T, KeyboardScreen } from "@/ui";

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
    <KeyboardScreen style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ChipRow>
          <Chip label="An interest" selected={kind === "interest"} onPress={() => setKind("interest")} />
          <Chip label="A question to debate" selected={kind === "question"} onPress={() => setKind("question")} />
        </ChipRow>
        <Field
          label={kind === "question" ? "The question" : "The topic"}
          value={title}
          onChangeText={setTitle}
          maxLength={120}
          placeholder={kind === "question" ? "Should jury duty pay a living wage?" : "The history of cartography"}
        />
        <Field label="One line on why it's interesting (optional)" value={blurb} onChangeText={setBlurb} maxLength={400} multiline style={styles.blurb} />
        <T variant="heading">Which fields does it touch?</T>
        <ChipRow>
          {FIELDS.map((field) => {
            const selected = fieldTags.includes(field);
            return (
              <Chip
                key={field}
                label={FIELD_LABELS[field]}
                selected={selected}
                disabled={!selected && fieldTags.length >= 4}
                onPress={() => setFieldTags(selected ? fieldTags.filter((item) => item !== field) : [...fieldTags, field])}
              />
            );
          })}
        </ChipRow>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </ScrollView>
      <View style={styles.actions}>
        <Button label="Suggest this topic" onPress={submit} busy={busy} disabled={title.trim().length < 4 || fieldTags.length === 0} />
      </View>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 20, gap: 16 },
  blurb: { minHeight: 72, textAlignVertical: "top" },
  actions: { padding: 20 },
});
