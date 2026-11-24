import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Calendar from "expo-calendar/legacy";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Linking, ScrollView, Share, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { useAuth } from "@/auth";
import { hasEnded, RsvpChips, stateLine, useMeetup } from "@/components/MeetupCard";
import { OutcomeForm } from "@/components/OutcomeForm";
import { describeWhen } from "@/format";
import { useTheme } from "@/theme";
import { Button, ErrorText, LoadError, T, useScrollPadding } from "@/ui";
import { t, venueLabel } from "@/i18n";

export default function MeetupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const padding = useScrollPadding();
  const { query, respond } = useMeetup(id);
  const [error, setError] = useState<string | null>(null);
  const invalidate = (meetup: unknown) => queryClient.setQueryData(["meetup", id], meetup);

  const didMeet = useMutation({
    mutationFn: (value: boolean) => api.post(`/meetups/${id}/did-meet`, { didMeet: value }),
    onSuccess: (meetup) => {
      invalidate(meetup);
      // The Chats tab stops asking about this meetup.
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
    onError: (caught) => setError(friendlyError(caught)),
  });
  const cancel = useMutation({ mutationFn: () => api.post(`/meetups/${id}/cancel`), onSuccess: invalidate, onError: (caught) => setError(friendlyError(caught)) });
  const invited = useMutation({ mutationFn: () => api.post(`/meetups/${id}/invite`), onSuccess: invalidate });
  const stopRepeating = useMutation({ mutationFn: () => api.post(`/meetups/${id}/repeat`, { repeat: "none" }), onSuccess: invalidate, onError: (caught) => setError(friendlyError(caught)) });

  const meetup = query.data;
  if (query.isError && !meetup) return <LoadError message={t("Couldn't load this meetup. Check your connection.", "Impossible de charger cette rencontre. Vérifiez votre connexion.")} onRetry={() => void query.refetch()} />;
  if (!meetup) return <ActivityIndicator accessibilityLabel={t("Loading meetup", "Chargement de la rencontre")} size="large" style={styles.loading} />;

  const place = meetup.venueNote || venueLabel(meetup.venueKind);
  const when = describeWhen(meetup.startsAt);
  const upcoming = (meetup.state === "proposed" || meetup.state === "confirmed") && !hasEnded(meetup);
  const live = meetup.state === "confirmed" && !hasEnded(meetup);

  /** Uses the phone's own share sheet. The chat hears that someone was invited once the sheet wasn't dismissed. */
  async function inviteSomeone() {
    const result = await Share.share({
      message: t(
        `Come to a Babillard meetup with us, ${when} at ${place}. Guests are welcome: ${meetup!.shareUrl}`,
        `Venez à une rencontre Babillard avec nous, ${when}, ${place}. Les personnes invitées sont les bienvenues: ${meetup!.shareUrl}`,
      ),
    });
    if (result.action !== Share.dismissedAction) invited.mutate();
  }

  async function addToCalendar() {
    try {
      await Calendar.createEventInCalendarAsync({ title: t("Babillard meetup", "Rencontre Babillard"), startDate: new Date(meetup!.startsAt), endDate: new Date(meetup!.endsAt), location: place, url: meetup!.shareUrl });
    } catch {
      // No calendar app that takes this request. The calendar file still works.
      await Linking.openURL(`${meetup!.shareUrl}.ics`).catch(() => setError(t("Couldn't open your calendar.", "Impossible d'ouvrir votre calendrier.")));
    }
  }

  function confirmCancel() {
    Alert.alert(t("Cancel this meetup?", "Annuler cette rencontre?"), t("Everyone in the chat will see that it's off.", "Tout le monde dans la discussion verra qu'elle n'a plus lieu."), [
      { text: t("Keep it", "La garder"), style: "cancel" },
      { text: t("Cancel meetup", "Annuler la rencontre"), style: "destructive", onPress: () => cancel.mutate() },
    ]);
  }

  function confirmStopRepeating() {
    Alert.alert(t("Stop repeating?", "Arrêter la répétition?"), t("No more dates will be proposed after this one, for anyone.", "Aucune autre date ne sera proposée après celle-ci, pour personne."), [
      { text: t("Keep repeating", "Continuer"), style: "cancel" },
      { text: t("Stop", "Arrêter"), style: "destructive", onPress: () => stopRepeating.mutate() },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={[padding, styles.body]}>
      <T variant="display">{when.replace(/^./, (letter) => letter.toUpperCase())}</T>
      <T variant="heading">{place}</T>
      {upcoming && meetup.repeat !== "none" ? (
        <T muted>{meetup.repeat === "weekly" ? t("Repeats every week.", "Se répète chaque semaine.") : t("Repeats every two weeks.", "Se répète toutes les deux semaines.")}</T>
      ) : null}
      <T variant="bodyBold" style={live ? { color: theme.good } : undefined} muted={!live}>
        {stateLine(meetup)}
      </T>

      <RsvpChips meetup={meetup} disabled={respond.isPending} onRespond={(response) => respond.mutate(response)} />
      {respond.isError ? <ErrorText>{friendlyError(respond.error)}</ErrorText> : null}

      {meetup.checkinOpen ? (
        <View style={styles.checkin}>
          <T variant="title">{t("Did you meet?", "La rencontre a-t-elle eu lieu?")}</T>
          {meetup.myDidMeet === null ? (
            <View style={styles.row}>
              <Button label={t("Yes, we met", "Oui")} onPress={() => didMeet.mutate(true)} style={styles.flex} busy={didMeet.isPending} />
              <Button label={t("It didn't happen", "Ça n'a pas eu lieu")} kind="secondary" onPress={() => didMeet.mutate(false)} style={styles.flex} disabled={didMeet.isPending} />
            </View>
          ) : (
            <T muted>{meetup.myDidMeet ? t("Glad you met.", "Tant mieux!") : t("Thanks for letting us know.", "Merci de nous l'avoir dit.")}</T>
          )}
          {meetup.myDidMeet ? <OutcomeForm key={meetup.myOutcome ? "answered" : "new"} meetup={meetup} /> : null}
        </View>
      ) : null}

      {upcoming ? (
        <View style={styles.actions}>
          {meetup.state === "confirmed" && meetup.myResponse !== "no" ? <Button label={t("Add to calendar", "Ajouter au calendrier")} kind={meetup.myResponse === "yes" ? "primary" : "secondary"} onPress={addToCalendar} /> : null}
          {meetup.inviteOpen ? (
            <Button label={t("Invite someone", "Inviter quelqu'un")} kind="secondary" onPress={() => void inviteSomeone()} />
          ) : (
            <Button label={t("Share the details", "Partager les détails")} kind="secondary" onPress={() => void Share.share({ message: t(`Meetup ${when} at ${place}: ${meetup.shareUrl}`, `Rencontre ${when}, ${place}: ${meetup.shareUrl}`) })} />
          )}
          {meetup.repeat !== "none" ? (
            <Button label={t("Stop repeating", "Arrêter la répétition")} kind="quiet" onPress={confirmStopRepeating} busy={stopRepeating.isPending} />
          ) : null}
          {meetup.proposedBy === me?.id ? <Button label={t("Cancel this meetup", "Annuler cette rencontre")} kind="danger" onPress={confirmCancel} busy={cancel.isPending} /> : null}
        </View>
      ) : null}

      {upcoming ? (
        <T variant="small" muted>
          {t("First time meeting? Choose a public place and tell a friend.", "Première rencontre? Choisissez un lieu public et prévenez quelqu'un.")}
        </T>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1 },
  body: { gap: 14 },
  checkin: { gap: 10, paddingVertical: 8 },
  row: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  actions: { gap: 10, marginTop: 8 },
});
