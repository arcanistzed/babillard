import { ROLES, type Me } from "@babillard/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { useAuth } from "@/auth";
import { AgeRangeField, ageRangeText, parseAgeRange } from "@/components/AgeRangeField";
import { CityPicker } from "@/components/CityPicker";
import { FieldPicker } from "@/components/FieldPicker";
import { LookingForPicker } from "@/components/LookingForPicker";
import { Button, Chip, ChipRow, ErrorText, Field, KeyboardScreen, T, useBottomPadding } from "@/ui";
import { roleLabel, t } from "@/i18n";

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
  const [ageRange, setAgeRange] = useState(ageRangeText(profile?.ageMin, profile?.ageMax));
  const range = parseAgeRange(ageRange);
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
      setMe(await api.put<Me>("/me/profile", { displayName: displayName.trim(), bio: bio.trim(), role, fields, lookingFor, cityId, campusId, ageMin: range.ageMin, ageMax: range.ageMax }));
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
        <Field label={t("Your first name", "Votre prénom")} value={displayName} onChangeText={setDisplayName} maxLength={50} />
        <Field label={t("A line about you", "Une phrase sur vous")} value={bio} onChangeText={setBio} multiline maxLength={500} style={styles.bio} />
        <T variant="heading">{t("What do you do?", "Que faites-vous?")}</T>
        <ChipRow>{ROLES.map((value) => <Chip key={value} label={roleLabel(value)} selected={role === value} onPress={() => setRole(value)} />)}</ChipRow>
        <T variant="heading">{t("What are you looking for?", "Que recherchez-vous?")}</T>
        <LookingForPicker value={lookingFor} onChange={setLookingFor} />
        <AgeRangeField value={ageRange} onChange={setAgeRange} error={range.error} />
        <T variant="heading">{t("Where can you meet people?", "Où pouvez-vous rencontrer des gens?")}</T>
        <CityPicker cityId={cityId} campusId={campusId} onChange={setLocation} />
        <T variant="heading">{t("Fields you care about", "Domaines qui vous intéressent")}</T>
        <FieldPicker value={fields} onChange={setFields} max={8} />
        {error ? <ErrorText>{error}</ErrorText> : null}
      </ScrollView>
      <View style={[styles.actions, { paddingBottom: bottomPadding }]}>
        <Button label={t("Save changes", "Enregistrer")} onPress={save} busy={busy} disabled={!displayName.trim() || fields.length === 0 || lookingFor.length === 0 || !cityId || range.error !== null} />
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
