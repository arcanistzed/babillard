import { FIELDS, FIELD_LABELS, ROLES, ROLE_LABELS, isAdult, type Field as FieldName, type LookingFor, type Me, type Role } from "@ideas-match/shared";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeInLeft, FadeInRight, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, friendlyError, uploadAvatar } from "@/api";
import { useAuth } from "@/auth";
import { CityPicker } from "@/components/CityPicker";
import { LookingForPicker } from "@/components/LookingForPicker";
import { PhotoPicker, pickAndResizePhoto } from "@/components/PhotoPicker";
import { useTheme } from "@/theme";
import { Button, Chip, ChipRow, ErrorText, Field, KeyboardScreen, T, useKeyboardOpen } from "@/ui";

const STEP_COUNT = 5;

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** Accepts the digits as typed and shows them as YYYY-MM-DD. */
function formatDob(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean).join("-");
}

function StepProgress({ step }: { step: number }) {
  const theme = useTheme();
  const fill = useAnimatedStyle(() => ({ width: withTiming(`${((step + 1) / STEP_COUNT) * 100}%`, { duration: 220 }) }));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={`Step ${step + 1} of ${STEP_COUNT}`} style={[styles.progress, { backgroundColor: theme.line }]}>
      <Animated.View style={[styles.progressFill, { backgroundColor: theme.accent }, fill]} />
    </View>
  );
}

export default function Onboard() {
  const { setMe, signOut } = useAuth();
  const [step, setStep] = useState(0);
  const [goingBack, setGoingBack] = useState(false);
  const keyboardOpen = useKeyboardOpen();
  const [displayName, setDisplayName] = useState("");
  const [dob, setDob] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [fields, setFields] = useState<FieldName[]>([]);
  const [lookingFor, setLookingFor] = useState<LookingFor[]>([]);
  const [cityId, setCityId] = useState<string | null>(null);
  const [campusId, setCampusId] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setLocation = useCallback((nextCity: string | null, nextCampus: string | null) => {
    setCityId(nextCity);
    setCampusId(nextCampus);
  }, []);

  function goTo(next: number) {
    setGoingBack(next < step);
    setStep(next);
  }

  // While someone is typing a city, the results need the room, and Continue can't be tapped yet anyway.
  const searchingForCity = step === 3 && cityId === null && keyboardOpen;
  const dobComplete = /^\d{4}-\d{2}-\d{2}$/.test(dob);
  const dobError = dobComplete && !isAdult(dob) ? "Ideas Match is for people 18 and over." : null;
  const canContinue = [
    displayName.trim().length > 0 && dobComplete && !dobError,
    role !== null && fields.length > 0,
    lookingFor.length > 0,
    cityId !== null,
    true,
  ][step];

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const me = await api.put<Me>("/me/onboarding", { displayName: displayName.trim(), bio: bio.trim(), role, fields, lookingFor, dob, cityId, campusId });
      if (photoUri) await uploadAvatar(photoUri).catch(() => undefined);
      setMe(photoUri ? await api.get<Me>("/me") : me);
    } catch (caught) {
      setError(friendlyError(caught));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardScreen style={styles.screen}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <StepProgress step={step} />

          <Animated.View key={step} entering={(goingBack ? FadeInLeft : FadeInRight).duration(220)} style={styles.step}>
            {step === 0 ? (
              <>
                <T variant="title">Who are you?</T>
                <Field label="Your first name" value={displayName} onChangeText={setDisplayName} autoComplete="given-name" maxLength={50} autoFocus />
                <Field
                  label="Date of birth"
                  value={dob}
                  onChangeText={(value) => setDob(formatDob(value))}
                  keyboardType="number-pad"
                  placeholder="YYYY-MM-DD"
                  error={dobError}
                />
                <T variant="small" muted>
                  You must be 18 or older. This stays private.
                </T>
              </>
            ) : null}

            {step === 1 ? (
              <>
                <T variant="title">What do you study or work on?</T>
                <ChipRow>
                  {ROLES.map((value) => (
                    <Chip key={value} label={ROLE_LABELS[value]} selected={role === value} onPress={() => setRole(value)} />
                  ))}
                </ChipRow>
                <T variant="heading">Pick the fields you care about</T>
                <ChipRow>
                  {FIELDS.map((value) => (
                    <Chip key={value} label={FIELD_LABELS[value]} selected={fields.includes(value)} disabled={!fields.includes(value) && fields.length >= 8} onPress={() => setFields(toggle(fields, value))} />
                  ))}
                </ChipRow>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <T variant="title">What are you looking for?</T>
                <LookingForPicker value={lookingFor} onChange={setLookingFor} />
              </>
            ) : null}

            {step === 3 ? (
              <>
                <T variant="title">Where can you meet people?</T>
                <CityPicker cityId={cityId} campusId={campusId} onChange={setLocation} />
              </>
            ) : null}

            {step === 4 ? (
              <>
                <T variant="title">Add a photo and a line about you</T>
                <T muted>Optional.</T>
                <PhotoPicker name={displayName} uri={photoUri} onPress={async () => setPhotoUri((await pickAndResizePhoto()) ?? photoUri)} />
                <Field label="A line about you" value={bio} onChangeText={setBio} multiline maxLength={500} placeholder="Writing a thesis on rent control. Will trade coffee for arguments." style={styles.bio} />
              </>
            ) : null}

          </Animated.View>

          {error ? <ErrorText>{error}</ErrorText> : null}
        </ScrollView>

        {searchingForCity ? null : (
          <View style={styles.actions}>
            {step === STEP_COUNT - 1 ? (
              <Button label="Start swiping" onPress={finish} busy={busy} />
            ) : (
              <Button label="Continue" onPress={() => goTo(step + 1)} disabled={!canContinue} />
            )}
            {step > 0 ? <Button label="Back" kind="quiet" onPress={() => goTo(step - 1)} /> : <Button label="Use a different email" kind="quiet" onPress={signOut} />}
          </View>
        )}
      </KeyboardScreen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 24, gap: 20 },
  step: { gap: 16 },
  progress: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  actions: { paddingHorizontal: 24, paddingBottom: 8, gap: 4 },
  bio: { minHeight: 96, textAlignVertical: "top" },
});
