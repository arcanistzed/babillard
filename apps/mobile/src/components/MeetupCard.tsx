import { VENUE_LABELS, type MeetupSummary } from "@ideas-match/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { api } from "@/api";
import { describeWhen } from "@/format";
import { fonts, useTheme } from "@/theme";
import { Chip, ChipRow, T } from "@/ui";

export function stateLine(meetup: MeetupSummary): string {
  switch (meetup.state) {
    case "confirmed":
      return "It's on";
    case "cancelled":
      return "Cancelled";
    case "done":
      return "This meetup has passed";
    default:
      return `${meetup.yesCount} of ${meetup.requiredYes} yeses needed`;
  }
}

export function useMeetup(id: string) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["meetup", id], queryFn: () => api.get<MeetupSummary>(`/meetups/${id}`) });
  const respond = useMutation({
    mutationFn: (response: "yes" | "no" | "maybe") => api.post<MeetupSummary>(`/meetups/${id}/respond`, { response }),
    onSuccess: (meetup) => {
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
      <Chip label="I'll be there" selected={meetup.myResponse === "yes"} disabled={disabled} onPress={() => onRespond("yes")} />
      <Chip label="Maybe" selected={meetup.myResponse === "maybe"} disabled={disabled} onPress={() => onRespond("maybe")} />
      <Chip label="Can't make it" selected={meetup.myResponse === "no"} disabled={disabled} onPress={() => onRespond("no")} />
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
      <Pressable accessibilityRole="button" accessibilityLabel="Open meetup details" onPress={() => router.push(`/meetup/${id}`)} style={styles.details}>
        <T variant="heading">{describeWhen(meetup.startsAt).replace(/^./, (letter) => letter.toUpperCase())}</T>
        <T>{meetup.venueNote || VENUE_LABELS[meetup.venueKind]}</T>
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
