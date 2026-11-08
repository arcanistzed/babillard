import { meetupDays, meetupSlotAt, meetupTimes, suggestMeetupSlots, VENUE_KINDS, type MeetupSummary, type VenueKind } from "@babillard/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { Button, Chip, ChipRow, ErrorText, Field, FormScreen, T } from "@/ui";
import { slotLabel, t, venueLabel } from "@/i18n";

/** Everything starts filled in, so proposing a meetup can be a single tap. */
export default function NewMeetup() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const queryClient = useQueryClient();
  const slots = useMemo(() => suggestMeetupSlots(), []);
  const [slotIndex, setSlotIndex] = useState(0);
  const [customOpen, setCustomOpen] = useState(false);
  const days = useMemo(() => meetupDays(), []);
  const [dayIndex, setDayIndex] = useState(0);
  const [customTime, setCustomTime] = useState<Date | null>(null);
  const times = useMemo(() => meetupTimes(days[dayIndex]!), [days, dayIndex]);
  const [venueKind, setVenueKind] = useState<VenueKind>("cafe");
  const [venueNote, setVenueNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function propose() {
    const slot = customOpen ? customTime && meetupSlotAt(customTime) : slots[slotIndex];
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<MeetupSummary>(`/meetups?conversationId=${conversationId}`, { startsAt: slot.startsAt, endsAt: slot.endsAt, venueKind, venueNote: venueNote.trim() });
      await queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
      router.back();
    } catch (caught) {
      setError(friendlyError(caught));
      setBusy(false);
    }
  }

  return (
    <FormScreen gap={22}>
        <View style={styles.section}>
          <T variant="heading">{t("When?", "Quand?")}</T>
          <ChipRow>
            {slots.map((slot, index) => (
              <Chip
                key={slot.startsAt}
                label={slotLabel(slot.label)}
                selected={!customOpen && index === slotIndex}
                onPress={() => {
                  setCustomOpen(false);
                  setSlotIndex(index);
                }}
              />
            ))}
            <Chip label={t("Pick another time", "Choisir un autre moment")} selected={customOpen} onPress={() => setCustomOpen(true)} />
          </ChipRow>
          {customOpen ? (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipLine}>
                {days.map((day, index) => (
                  <Chip
                    key={day.getTime()}
                    label={day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                    selected={index === dayIndex}
                    onPress={() => {
                      setDayIndex(index);
                      setCustomTime(null);
                    }}
                  />
                ))}
              </ScrollView>
              {times.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipLine}>
                  {times.map((time) => (
                    <Chip key={time.getTime()} label={time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} selected={time.getTime() === customTime?.getTime()} onPress={() => setCustomTime(time)} />
                  ))}
                </ScrollView>
              ) : (
                <T muted>{t("No times left today. Pick another day.", "Plus d'heures aujourd'hui. Choisissez un autre jour.")}</T>
              )}
            </>
          ) : null}
        </View>
        <View style={styles.section}>
          <T variant="heading">{t("Where?", "Où?")}</T>
          <ChipRow>
            {VENUE_KINDS.map((kind) => (
              <Chip key={kind} label={venueLabel(kind)} selected={kind === venueKind} onPress={() => setVenueKind(kind)} />
            ))}
          </ChipRow>
          <Field label={t("Name the place (optional)", "Nom du lieu (facultatif)")} value={venueNote} onChangeText={setVenueNote} maxLength={200} placeholder={t("Blue Door on Main Street", "La Porte bleue, rue Principale")} />
        </View>
        <T variant="small" muted>
          {t("First time meeting? Choose a public place and tell a friend.", "Première rencontre? Choisissez un lieu public et prévenez quelqu'un.")}
        </T>
        {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label={t("Propose this meetup", "Proposer cette rencontre")} onPress={propose} busy={busy} disabled={customOpen && !customTime} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  chipLine: { gap: 8 },
});
