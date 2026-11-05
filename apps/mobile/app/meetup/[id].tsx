import { VENUE_LABELS } from "@ideas-match/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Calendar from "expo-calendar/legacy";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Linking, ScrollView, Share, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { useAuth } from "@/auth";
import { RsvpChips, stateLine, useMeetup } from "@/components/MeetupCard";
import { describeWhen } from "@/format";
import { useTheme } from "@/theme";
import { Button, ErrorText, T } from "@/ui";

export default function MeetupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { query, respond } = useMeetup(id);
  const [error, setError] = useState<string | null>(null);
  const invalidate = (meetup: unknown) => queryClient.setQueryData(["meetup", id], meetup);

  const didMeet = useMutation({ mutationFn: (value: boolean) => api.post(`/meetups/${id}/did-meet`, { didMeet: value }), onSuccess: invalidate, onError: (caught) => setError(friendlyError(caught)) });
  const cancel = useMutation({ mutationFn: () => api.post(`/meetups/${id}/cancel`), onSuccess: invalidate, onError: (caught) => setError(friendlyError(caught)) });

  const meetup = query.data;
  if (query.isError) return <View style={styles.body}><ErrorText>Couldn't load this meetup.</ErrorText></View>;
  if (!meetup) return <ActivityIndicator accessibilityLabel="Loading meetup" size="large" style={styles.loading} />;

  const place = meetup.venueNote || VENUE_LABELS[meetup.venueKind];
  const when = describeWhen(meetup.startsAt);
  const upcoming = meetup.state === "proposed" || meetup.state === "confirmed";

  async function addToCalendar() {
    try {
      await Calendar.createEventInCalendarAsync({ title: "Ideas Match meetup", startDate: new Date(meetup!.startsAt), endDate: new Date(meetup!.endsAt), location: place, url: meetup!.shareUrl });
    } catch {
      // No calendar app that takes this request. The calendar file still works.
      await Linking.openURL(`${meetup!.shareUrl}.ics`).catch(() => setError("Couldn't open your calendar."));
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <T variant="display">{when.replace(/^./, (letter) => letter.toUpperCase())}</T>
      <T variant="heading">{place}</T>
      <T variant="bodyBold" style={meetup.state === "confirmed" ? { color: theme.good } : undefined} muted={meetup.state !== "confirmed"}>
        {stateLine(meetup)}
      </T>

      <RsvpChips meetup={meetup} disabled={respond.isPending} onRespond={(response) => respond.mutate(response)} />
      {respond.isError ? <ErrorText>{friendlyError(respond.error)}</ErrorText> : null}

      {meetup.checkinOpen ? (
        <View style={styles.checkin}>
          <T variant="title">Did you meet?</T>
          {meetup.myDidMeet === null ? (
            <View style={styles.row}>
              <Button label="Yes, we met" onPress={() => didMeet.mutate(true)} style={styles.flex} busy={didMeet.isPending} />
              <Button label="It didn't happen" kind="secondary" onPress={() => didMeet.mutate(false)} style={styles.flex} disabled={didMeet.isPending} />
            </View>
          ) : (
            <T muted>{meetup.myDidMeet ? "Glad it happened. Thanks for telling us." : "Thanks for telling us. There's always next time."}</T>
          )}
        </View>
      ) : null}

      {upcoming ? (
        <View style={styles.actions}>
          {meetup.state === "confirmed" ? <Button label="Add to calendar" onPress={addToCalendar} /> : null}
          <Button label="Share the details" kind="secondary" onPress={() => void Share.share({ message: `Meetup ${when} at ${place}: ${meetup.shareUrl}` })} />
          {meetup.proposedBy === me?.id ? <Button label="Cancel this meetup" kind="danger" onPress={() => cancel.mutate()} busy={cancel.isPending} /> : null}
        </View>
      ) : null}

      {upcoming ? (
        <T variant="small" muted>
          Meeting someone for the first time? Pick a public place and tell a friend where you're going.
        </T>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1 },
  body: { padding: 20, gap: 14 },
  checkin: { gap: 10, paddingVertical: 8 },
  row: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  actions: { gap: 10, marginTop: 8 },
});
