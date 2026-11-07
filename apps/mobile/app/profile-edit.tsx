import { FIELDS, FIELD_LABELS, ROLES, ROLE_LABELS, type Me } from "@ideas-match/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { useAuth } from "@/auth";
import { CityPicker } from "@/components/CityPicker";
import { LookingForPicker } from "@/components/LookingForPicker";
import { Button, Chip, ChipRow, ErrorText, Field, KeyboardScreen, T, useBottomPadding } from "@/ui";

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export default function ProfileEdit() {
  const { me, setMe } = useAuth();
  const queryClient = useQueryClient();
  const bottomPadding = useBottomPadding(12);
  const profile = me?.profile;
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [role, setRole] = useState(profile?.role ?? "other");
  const [fields, setFields] = useState(profile?.fields ?? []);
  const [lookingFor, setLookingFor] = useState(profile?.lookingFor ?? []);
  const [cityId, setCityId] = useState<string | null>(me?.cityId ?? null);
  const [campusId, setCampusId] = useState<string | null>(me?.campusId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setLocation = useCallback((nextCity: string | null, nextCampus: string | null) => {
    setCityId(nextCity);
    setCampusId(nextCampus);
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      setMe(await api.put<Me>("/me/profile", { displayName: displayName.trim(), bio: bio.trim(), role, fields, lookingFor, cityId, campusId }));
      await queryClient.invalidateQueries({ queryKey: ["people"] });
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
        <Field label="Your first name" value={displayName} onChangeText={setDisplayName} maxLength={50} />
        <Field label="A line about you" value={bio} onChangeText={setBio} multiline maxLength={500} style={styles.bio} />
        <T variant="heading">What do you do?</T>
        <ChipRow>{ROLES.map((value) => <Chip key={value} label={ROLE_LABELS[value]} selected={role === value} onPress={() => setRole(value)} />)}</ChipRow>
        <T variant="heading">What are you looking for?</T>
        <LookingForPicker value={lookingFor} onChange={setLookingFor} />
        <T variant="heading">Where can you meet people?</T>
        <CityPicker cityId={cityId} campusId={campusId} onChange={setLocation} />
        <T variant="heading">Fields you care about</T>
        <ChipRow>
          {FIELDS.map((value) => (
            <Chip key={value} label={FIELD_LABELS[value]} selected={fields.includes(value)} disabled={!fields.includes(value) && fields.length >= 8} onPress={() => setFields(toggle(fields, value))} />
          ))}
        </ChipRow>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </ScrollView>
      <View style={[styles.actions, { paddingBottom: bottomPadding }]}>
        <Button label="Save changes" onPress={save} busy={busy} disabled={!displayName.trim() || fields.length === 0 || lookingFor.length === 0 || !cityId} />
      </View>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 20, gap: 14 },
  bio: { minHeight: 96, textAlignVertical: "top" },
  actions: { paddingHorizontal: 20, paddingTop: 12 },
});
