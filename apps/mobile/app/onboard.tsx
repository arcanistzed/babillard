import { ROLES, type Field as FieldName, type LookingFor, type Me, type Role } from "@babillard/shared";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeInLeft, FadeInRight, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, friendlyError, uploadAvatar } from "@/api";
import { useAuth } from "@/auth";
import { CityPicker } from "@/components/CityPicker";
import { DateOfBirthField } from "@/components/DateOfBirthField";
import { FieldPicker } from "@/components/FieldPicker";
import { TermsAgreement } from "@/components/TermsAgreement";
import { LookingForPicker } from "@/components/LookingForPicker";
import { PhotoPicker, pickAndResizePhoto } from "@/components/PhotoPicker";
import { useTheme } from "@/theme";
import { Button, Chip, ChipRow, ErrorText, Field, KeyboardScreen, T, useKeyboardOpen } from "@/ui";
import { roleLabel, t } from "@/i18n";

const STEP_COUNT = 5;

function StepProgress({ step }: { step: number }) {
  const theme = useTheme();
  const fill = useAnimatedStyle(() => ({ width: withTiming(`${((step + 1) / STEP_COUNT) * 100}%`, { duration: 220 }) }));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={t(`Step ${step + 1} of ${STEP_COUNT}`, `Étape ${step + 1} sur ${STEP_COUNT}`)} style={[styles.progress, { backgroundColor: theme.line }]}>
      <Animated.View style={[styles.progressFill, { backgroundColor: theme.accent }, fill]} />
    </View>
  );
}

export default function Onboard() {
  const { setMe, signOut } = useAuth();
  const [step, setStep] = useState(0);
  const [goingBack, setGoingBack] = useState(false);
  const keyboardOpen = useKeyboardOpen();
  const [agreed, setAgreed] = useState(false);
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
  const canContinue = [
    displayName.trim().length > 0 && dob !== "" && agreed,
    role !== null && fields.length > 0,
    lookingFor.length > 0,
    cityId !== null,
    true,
  ][step];

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const me = await api.put<Me>("/me/onboarding", { acceptedTerms: agreed, displayName: displayName.trim(), bio: bio.trim(), role, fields, lookingFor, dob, cityId, campusId });
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
                <T variant="title">{t("Who are you?", "Qui êtes-vous?")}</T>
                <Field label={t("Your first name", "Votre prénom")} value={displayName} onChangeText={setDisplayName} autoComplete="given-name" maxLength={50} autoFocus />
                <DateOfBirthField onChange={setDob} />
                <T variant="small" muted>
                  {t("Your date of birth stays private.", "Votre date de naissance reste privée.")}
                </T>
                <TermsAgreement agreed={agreed} onChange={setAgreed} />
              </>
            ) : null}

            {step === 1 ? (
              <>
                <T variant="title">{t("What do you study or work on?", "Qu'étudiez-vous, ou sur quoi travaillez-vous?")}</T>
                <ChipRow>
                  {ROLES.map((value) => (
                    <Chip key={value} label={roleLabel(value)} selected={role === value} onPress={() => setRole(value)} />
                  ))}
                </ChipRow>
                <T variant="heading">{t("Pick the fields you care about", "Choisissez les domaines qui vous intéressent")}</T>
                <FieldPicker value={fields} onChange={setFields} max={8} />
              </>
            ) : null}

            {step === 2 ? (
              <>
                <T variant="title">{t("What are you looking for?", "Que recherchez-vous?")}</T>
                <LookingForPicker value={lookingFor} onChange={setLookingFor} />
              </>
            ) : null}

            {step === 3 ? (
              <>
                <T variant="title">{t("Where can you meet people?", "Où pouvez-vous rencontrer des gens?")}</T>
                <CityPicker cityId={cityId} campusId={campusId} onChange={setLocation} />
              </>
            ) : null}

            {step === 4 ? (
              <>
                <T variant="title">{t("Add a photo and a line about you", "Ajoutez une photo et une phrase sur vous")}</T>
                <T muted>{t("Optional.", "Facultatif.")}</T>
                <PhotoPicker name={displayName} uri={photoUri} onPress={async () => setPhotoUri((await pickAndResizePhoto()) ?? photoUri)} />
                <Field label={t("A line about you", "Une phrase sur vous")} value={bio} onChangeText={setBio} multiline maxLength={500} placeholder={t("Writing a thesis on rent control. Will trade coffee for arguments.", "Thèse sur le contrôle des loyers. J'échange café contre arguments.")} style={styles.bio} />
              </>
            ) : null}

          </Animated.View>

          {error ? <ErrorText>{error}</ErrorText> : null}
        </ScrollView>

        {searchingForCity ? null : (
          <View style={styles.actions}>
            {step === STEP_COUNT - 1 ? (
              <Button label={t("Start swiping", "Commencer")} onPress={finish} busy={busy} />
            ) : (
              <Button label={t("Continue", "Continuer")} onPress={() => goTo(step + 1)} disabled={!canContinue} />
            )}
            {step > 0 ? <Button label={t("Back", "Retour")} kind="quiet" onPress={() => goTo(step - 1)} /> : <Button label={t("Use a different email", "Utiliser un autre courriel")} kind="quiet" onPress={signOut} />}
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
