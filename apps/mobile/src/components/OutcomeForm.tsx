import { TAKEAWAY_MAX_LENGTH, type EndedUp, type MeetAgain, type MeetupSummary, type MindChanged, type MyOutcome } from "@babillard/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { t } from "@/i18n";
import { Button, Chip, ChipRow, ErrorText, Field, T } from "@/ui";

function Question<Value extends string>({ label, options, value, onChange }: { label: string; options: [Value, string][]; value: Value | null; onChange: (value: Value) => void }) {
  return (
    <View style={styles.question} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <T variant="bodyBold">{label}</T>
      <ChipRow>
        {options.map(([option, text]) => (
          <Chip key={option} label={text} selected={value === option} onPress={() => onChange(option)} />
        ))}
      </ChipRow>
    </View>
  );
}

/** Asked privately after "Yes, we met". Only percentages per topic are shown, and only once enough people answer. */
export function OutcomeForm({ meetup }: { meetup: MeetupSummary }) {
  const queryClient = useQueryClient();
  const saved = meetup.myOutcome;
  const [editing, setEditing] = useState(saved === null);
  const [mindChanged, setMindChanged] = useState<MindChanged | null>(saved?.mindChanged ?? null);
  const [endedUp, setEndedUp] = useState<EndedUp | null>(saved?.endedUp ?? null);
  const [meetAgain, setMeetAgain] = useState<MeetAgain | null>(saved?.meetAgain ?? null);
  const [takeaway, setTakeaway] = useState(saved?.takeaway ?? "");

  const submit = useMutation({
    mutationFn: (outcome: MyOutcome) => api.post<MeetupSummary>(`/meetups/${meetup.id}/outcome`, outcome),
    onSuccess: (fresh) => {
      queryClient.setQueryData(["meetup", meetup.id], fresh);
      setEditing(false);
    },
  });

  if (!editing) {
    return (
      <View style={styles.form}>
        <T muted>{t("Thanks. Your answers help show what these conversations lead to.", "Merci. Vos réponses montrent ce que ces conversations donnent.")}</T>
        <Button label={t("Change my answers", "Modifier mes réponses")} kind="secondary" onPress={() => setEditing(true)} />
      </View>
    );
  }

  const ready = mindChanged && endedUp && meetAgain;
  return (
    <View style={styles.form}>
      <T variant="title">{t("How did it go?", "Comment ça s'est passé?")}</T>
      <T variant="small" muted>
        {t("Your answers stay private. The app only shows percentages for each topic, once enough people have answered.", "Vos réponses restent privées. L'application affiche seulement des pourcentages par sujet, une fois qu'assez de gens ont répondu.")}
      </T>
      <Question
        label={t("Did anyone change their mind?", "Quelqu'un a-t-il changé d'avis?")}
        value={mindChanged}
        onChange={setMindChanged}
        options={[
          ["mine", t("Yes, I did", "Oui, moi")],
          ["other", t("Someone else did", "Quelqu'un d'autre")],
          ["no", t("No", "Non")],
        ]}
      />
      <Question
        label={t("Where did you end up?", "Où en êtes-vous arrivés?")}
        value={endedUp}
        onChange={setEndedUp}
        options={[
          ["agreed", t("Mostly agreed", "Surtout d'accord")],
          ["split", t("Split", "Partagés")],
          ["disagreed", t("Mostly disagreed", "Surtout en désaccord")],
        ]}
      />
      <Question
        label={t("Would you meet again on this topic?", "Vous reverriez-vous pour en parler?")}
        value={meetAgain}
        onChange={setMeetAgain}
        options={[
          ["yes", t("Yes", "Oui")],
          ["maybe", t("Maybe", "Peut-être")],
          ["no", t("No", "Non")],
        ]}
      />
      <Field
        label={t("One thing you took away (optional)", "Ce que vous en retenez (facultatif)")}
        value={takeaway}
        onChangeText={setTakeaway}
        maxLength={TAKEAWAY_MAX_LENGTH}
        multiline
      />
      <T variant="small" muted>
        {t(
          "This line isn't encrypted. A moderator reads it, and if approved it appears on the topic's public page without your name. Leave out names and anything that could identify someone.",
          "Cette phrase n'est pas chiffrée. Un modérateur la lit et, si elle est approuvée, elle paraît sur la page publique du sujet, sans votre nom. N'y mettez ni noms ni détails qui permettraient d'identifier quelqu'un.",
        )}
      </T>
      <Button
        label={t("Send answers", "Envoyer mes réponses")}
        disabled={!ready}
        busy={submit.isPending}
        onPress={() => ready && submit.mutate({ mindChanged, endedUp, meetAgain, takeaway: takeaway.trim() })}
      />
      {submit.isError ? <ErrorText>{friendlyError(submit.error)}</ErrorText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  question: { gap: 8 },
});
