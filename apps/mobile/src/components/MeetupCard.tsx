import type { MeetupSummary } from "@babillard/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { api } from "@/api";
import { describeWhen } from "@/format";
import { haptics } from "@/haptics";
import { fonts, useTheme } from "@/theme";
import { Chip, ChipRow, T } from "@/ui";
import { t, venueLabel } from "@/i18n";

export function stateLine(meetup: MeetupSummary): string {
  switch (meetup.state) {
    case "confirmed":
      // The meetup is on, but not for someone who said they can't come.
      if (meetup.myResponse === "no") return t("On for the others. You said you can't make it.", "Confirmée pour les autres. Vous avez dit que vous ne pouvez pas venir.");
      if (meetup.myResponse === "maybe") return t("It's on. You said maybe.", "C'est confirmé. Vous avez répondu peut-être.");
      return t("It's on", "C'est confirmé");
    case "cancelled":
      return t("Cancelled", "Annulée");
    case "done":
      return t("This meetup has passed", "Cette rencontre est passée");
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
  const open = meetup.state === "proposed" || meetup.state === "confirmed";
  if (!open) return null;
  return (
    <ChipRow>
      <Chip label={t("I'll be there", "J'y serai")} selected={meetup.myResponse === "yes"} disabled={disabled} onPress={() => onRespond("yes")} />
      <Chip label={t("Maybe", "Peut-être")} selected={meetup.myResponse === "maybe"} disabled={disabled} onPress={() => onRespond("maybe")} />
      <Chip label={t("Can't make it", "Je ne peux pas")} selected={meetup.myResponse === "no"} disabled={disabled} onPress={() => onRespond("no")} />
    </ChipRow>
  );
}

/** Shows inside the chat, so answering takes one tap and no navigation. */
export function MeetupCard({ id }: { id: string }) {
  const theme = useTheme();
  const { query, respond } = useMeetup(id);
  const meetup = query.data;
  if (!meetup) return null;

  const faded = meetup.state === "cancelled" || meetup.state === "done";
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: meetup.state === "confirmed" ? theme.good : theme.ink, opacity: faded ? 0.65 : 1 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("Open meetup details", "Ouvrir les détails de la rencontre")} onPress={() => router.push(`/meetup/${id}`)} style={styles.details}>
        <T variant="heading">{describeWhen(meetup.startsAt).replace(/^./, (letter) => letter.toUpperCase())}</T>
        <T>{meetup.venueNote || venueLabel(meetup.venueKind)}</T>
        <T variant="small" style={{ fontFamily: fonts.bodyBold, color: meetup.state === "confirmed" ? theme.good : theme.muted }}>
          {stateLine(meetup)}
        </T>
      </Pressable>
      <RsvpChips meetup={meetup} disabled={respond.isPending} onRespond={(response) => respond.mutate(response)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 2, borderRadius: 12, padding: 14, gap: 10, marginHorizontal: 12, marginVertical: 6 },
  details: { gap: 2 },
});
