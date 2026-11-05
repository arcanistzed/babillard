import { VENUE_KINDS, VENUE_LABELS, suggestMeetupSlots, type MeetupSummary, type VenueKind } from "@ideas-match/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { Button, Chip, ChipRow, ErrorText, Field, T, KeyboardScreen } from "@/ui";

/** Everything starts filled in, so proposing a meetup can be a single tap. */
export default function NewMeetup() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const queryClient = useQueryClient();
  const slots = useMemo(() => suggestMeetupSlots(), []);
  const [slotIndex, setSlotIndex] = useState(0);
  const [venueKind, setVenueKind] = useState<VenueKind>("cafe");
  const [venueNote, setVenueNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function propose() {
    const slot = slots[slotIndex];
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
    <KeyboardScreen style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <T variant="heading">When?</T>
          <ChipRow>
            {slots.map((slot, index) => (
              <Chip key={slot.startsAt} label={slot.label} selected={index === slotIndex} onPress={() => setSlotIndex(index)} />
            ))}
          </ChipRow>
        </View>
        <View style={styles.section}>
          <T variant="heading">Where?</T>
          <ChipRow>
            {VENUE_KINDS.map((kind) => (
              <Chip key={kind} label={VENUE_LABELS[kind]} selected={kind === venueKind} onPress={() => setVenueKind(kind)} />
            ))}
          </ChipRow>
          <Field label="Name the place (optional)" value={venueNote} onChangeText={setVenueNote} maxLength={200} placeholder="Blue Door on Main Street" />
        </View>
        <T variant="small" muted>
          Meeting someone for the first time? Pick a public place and tell a friend where you're going.
        </T>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </ScrollView>
      <View style={styles.actions}>
        <Button label="Propose this meetup" onPress={propose} busy={busy} />
      </View>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 20, gap: 22 },
  section: { gap: 10 },
  actions: { padding: 20 },
});
