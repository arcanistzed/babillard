import type { MeetupSummary } from "@babillard/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { describeWhen } from "@/format";
import { haptics } from "@/haptics";
import { fonts, useTheme } from "@/theme";
import { Button, Chip, ChipRow, ErrorText, T } from "@/ui";
import { t, venueLabel } from "@/i18n";

/** Whether a meetup's time is over. It stays confirmed until the "Did you meet?" push a day later marks it done. */
export function hasEnded(meetup: Pick<MeetupSummary, "state" | "endsAt">, now = Date.now()): boolean {
  return meetup.state === "done" || (meetup.state === "confirmed" && meetup.endsAt <= now);
}

/** This person said they'd go and hasn't said whether it happened. */
export function awaitsCheckin(meetup: MeetupSummary): boolean {
  return meetup.checkinOpen && meetup.myResponse === "yes" && meetup.myDidMeet === null;
}

export function stateLine(meetup: MeetupSummary): string {
  if (hasEnded(meetup)) return t("This meetup has passed", "Cette rencontre est passée");
  switch (meetup.state) {
    case "confirmed":
      // The meetup is on, but not for someone who said they can't come.
      if (meetup.myResponse === "no") return t("On for the others. You said you can't make it.", "Confirmée pour les autres. Vous avez dit que vous ne pouvez pas venir.");
      if (meetup.myResponse === "maybe") return t("It's on. You said maybe.", "C'est confirmé. Vous avez répondu peut-être.");
      return t("It's on", "C'est confirmé");
    case "cancelled":
      return t("Cancelled", "Annulée");
    default:
      return t(`${meetup.yesCount} yes so far, ${meetup.requiredYes} needed`, `${meetup.yesCount} oui jusqu'ici, ${meetup.requiredYes} requis`);
  }
}

export function useMeetup(id: string) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["meetup", id], queryFn: () => api.get<MeetupSummary>(`/meetups/${id}`) });
  const respond = useMutation({
    mutationFn: (response: "yes" | "no" | "maybe") => api.post<MeetupSummary>(`/meetups/${id}/respond`, { response }),
    onSuccess: (meetup) => {
      const before = queryClient.getQueryData<MeetupSummary>(["meetup", id]);
      if (meetup.state === "confirmed" && before?.state !== "confirmed") haptics.celebrate();
      queryClient.setQueryData(["meetup", id], meetup);
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
  return { query, respond };
}

export function RsvpChips({ meetup, onRespond, disabled }: { meetup: MeetupSummary; onRespond: (response: "yes" | "no" | "maybe") => void; disabled?: boolean }) {
  const open = (meetup.state === "proposed" || meetup.state === "confirmed") && !hasEnded(meetup);
  if (!open) return null;
  return (
    <ChipRow accessibilityRole="radiogroup" accessibilityLabel={t("Your answer", "Votre réponse")}>
      <Chip role="radio" label={t("I'll be there", "J'y serai")} selected={meetup.myResponse === "yes"} disabled={disabled} onPress={() => onRespond("yes")} />
      <Chip role="radio" label={t("Maybe", "Peut-être")} selected={meetup.myResponse === "maybe"} disabled={disabled} onPress={() => onRespond("maybe")} />
      <Chip role="radio" label={t("Can't make it", "Je ne peux pas")} selected={meetup.myResponse === "no"} disabled={disabled} onPress={() => onRespond("no")} />
    </ChipRow>
  );
}

/** Shows inside the chat, so answering takes one tap and no navigation. */
export function MeetupCard({ id }: { id: string }) {
  const theme = useTheme();
  const { query, respond } = useMeetup(id);
  const meetup = query.data;
  if (!meetup) return null;

  const ended = hasEnded(meetup);
  const asking = awaitsCheckin(meetup);
  const faded = (meetup.state === "cancelled" || ended) && !asking;
  const live = meetup.state === "confirmed" && !ended;
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: live ? theme.good : asking ? theme.accent : theme.ink, opacity: faded ? 0.65 : 1 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("Open meetup details", "Ouvrir les détails de la rencontre")} onPress={() => router.push(`/meetup/${id}`)} style={styles.details}>
        <T variant="heading">{describeWhen(meetup.startsAt).replace(/^./, (letter) => letter.toUpperCase())}</T>
        <T>{meetup.venueNote || venueLabel(meetup.venueKind)}</T>
        <T variant="small" style={{ fontFamily: fonts.bodyBold, color: live ? theme.good : theme.muted }}>
          {stateLine(meetup)}
        </T>
        {asking ? (
          <T variant="small" style={{ fontFamily: fonts.bodyBold, color: theme.accent }}>
            {t("Did you meet? Tap to tell us.", "La rencontre a-t-elle eu lieu? Touchez pour nous le dire.")}
          </T>
        ) : null}
      </Pressable>
      <RsvpChips meetup={meetup} disabled={respond.isPending} onRespond={(response) => respond.mutate(response)} />
    </View>
  );
}

/**
 * Asks at the top of the Chats tab whether a meetup happened, a couple of hours after it ended. The push only comes a day later.
 * Saying yes opens the meetup, where the questions about how it went are.
 */
export function CheckinPrompt({ meetupId, startsAt, title }: { meetupId: string; startsAt: number; title: string }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const answer = useMutation({
    mutationFn: (didMeet: boolean) => api.post<MeetupSummary>(`/meetups/${meetupId}/did-meet`, { didMeet }),
    onSuccess: (meetup, didMeet) => {
      queryClient.setQueryData(["meetup", meetupId], meetup);
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      if (didMeet) router.push(`/meetup/${meetupId}`);
    },
  });
  return (
    <View style={[styles.card, styles.prompt, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
      <T variant="heading">{t("Did you meet?", "La rencontre a-t-elle eu lieu?")}</T>
      <T muted>{`${title}, ${describeWhen(startsAt)}`}</T>
      <View style={styles.row}>
        <Button label={t("Yes, we met", "Oui")} onPress={() => answer.mutate(true)} style={styles.flex} busy={answer.isPending && answer.variables} disabled={answer.isPending && !answer.variables} />
        <Button label={t("It didn't happen", "Ça n'a pas eu lieu")} kind="secondary" onPress={() => answer.mutate(false)} style={styles.flex} busy={answer.isPending && !answer.variables} disabled={answer.isPending && answer.variables} />
      </View>
      {answer.isError ? <ErrorText>{friendlyError(answer.error)}</ErrorText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  prompt: { marginHorizontal: 20, marginVertical: 8 },
  row: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  card: { borderWidth: 2, borderRadius: 12, padding: 14, gap: 10, marginHorizontal: 12, marginVertical: 6 },
  details: { gap: 2 },
});
