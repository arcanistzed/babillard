import { FIELDS, FIELD_LABELS, LOOKING_FOR, LOOKING_FOR_LABELS, ROLES, ROLE_LABELS, type Me } from "@ideas-match/shared";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { useAuth } from "@/auth";
import { Button, Chip, ChipRow, ErrorText, Field, T, KeyboardScreen } from "@/ui";

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export default function ProfileEdit() {
  const { me, setMe } = useAuth();
  const profile = me?.profile;
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [role, setRole] = useState(profile?.role ?? "other");
  const [fields, setFields] = useState(profile?.fields ?? []);
  const [lookingFor, setLookingFor] = useState(profile?.lookingFor ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      setMe(await api.put<Me>("/me/profile", { displayName: displayName.trim(), bio: bio.trim(), role, fields, lookingFor }));
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
        <ChipRow>{LOOKING_FOR.map((value) => <Chip key={value} label={LOOKING_FOR_LABELS[value]} selected={lookingFor.includes(value)} onPress={() => setLookingFor(toggle(lookingFor, value))} />)}</ChipRow>
        {lookingFor.includes("more_than_friends") ? (
          <T variant="small" muted>
            Only people who also picked "more than friends" will see that on your profile.
          </T>
        ) : null}
        <T variant="heading">Fields you care about</T>
        <ChipRow>
          {FIELDS.map((value) => (
            <Chip key={value} label={FIELD_LABELS[value]} selected={fields.includes(value)} disabled={!fields.includes(value) && fields.length >= 8} onPress={() => setFields(toggle(fields, value))} />
          ))}
        </ChipRow>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </ScrollView>
      <View style={styles.actions}>
        <Button label="Save changes" onPress={save} busy={busy} disabled={!displayName.trim() || fields.length === 0 || lookingFor.length === 0} />
      </View>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 20, gap: 14 },
  bio: { minHeight: 96, textAlignVertical: "top" },
  actions: { padding: 20 },
});
