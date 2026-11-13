import { MAX_AGE_YEARS, MIN_AGE_YEARS } from "@babillard/shared";
import { StyleSheet, TextInput, View } from "react-native";
import { t } from "@/i18n";
import { fonts, useTheme } from "@/theme";
import { T } from "@/ui";

/** The typed text of each end. Blank means no limit at that end. */
export interface AgeRangeText {
  from: string;
  to: string;
}

export function ageRangeText(ageMin: number | null | undefined, ageMax: number | null | undefined): AgeRangeText {
  return { from: ageMin == null ? "" : String(ageMin), to: ageMax == null ? "" : String(ageMax) };
}

/** The range to save, or an error to show. */
export function parseAgeRange(text: AgeRangeText): { ageMin: number | null; ageMax: number | null; error: string | null } {
  const ageMin = text.from ? Number(text.from) : null;
  const ageMax = text.to ? Number(text.to) : null;
  const outside = [ageMin, ageMax].some((age) => age !== null && (age < MIN_AGE_YEARS || age > MAX_AGE_YEARS));
  if (outside) return { ageMin, ageMax, error: t(`Use ages from ${MIN_AGE_YEARS} to ${MAX_AGE_YEARS}.`, `Indiquez des âges de ${MIN_AGE_YEARS} à ${MAX_AGE_YEARS} ans.`) };
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) return { ageMin, ageMax, error: t("The first age should be the younger one.", "Le premier âge doit être le plus jeune.") };
  return { ageMin, ageMax, error: null };
}

export function AgeRangeField({ value, onChange, error }: { value: AgeRangeText; onChange: (value: AgeRangeText) => void; error: string | null }) {
  const theme = useTheme();
  const box = [styles.input, { color: theme.ink, borderColor: error ? theme.danger : theme.ink, backgroundColor: theme.surface }];
  const digits = (text: string) => text.replace(/\D/g, "").slice(0, 2);
  return (
    <View style={styles.field}>
      <T variant="heading">{t("Ages you want to meet", "Âges des personnes à rencontrer")}</T>
      <View style={styles.row}>
        <T>{t("From", "De")}</T>
        <TextInput
          value={value.from}
          onChangeText={(text) => onChange({ ...value, from: digits(text) })}
          keyboardType="number-pad"
          maxLength={2}
          placeholder={t("Any", "Tout")}
          placeholderTextColor={theme.muted}
          accessibilityLabel={t("Youngest age you want to meet", "Âge minimum des personnes à rencontrer")}
          style={box}
        />
        <T>{t("to", "à")}</T>
        <TextInput
          value={value.to}
          onChangeText={(text) => onChange({ ...value, to: digits(text) })}
          keyboardType="number-pad"
          maxLength={2}
          placeholder={t("Any", "Tout")}
          placeholderTextColor={theme.muted}
          accessibilityLabel={t("Oldest age you want to meet", "Âge maximum des personnes à rencontrer")}
          style={box}
        />
      </View>
      {error ? (
        <T variant="small" accessibilityLiveRegion="polite" style={{ color: theme.danger }}>
          {error}
        </T>
      ) : (
        <T variant="small" muted>
          {t("Leave a box blank for no limit. You'll only see people whose own range includes you.", "Laissez une case vide pour ne pas fixer de limite. Vous ne verrez que les personnes dont la tranche vous inclut.")}
        </T>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: { width: 72, minHeight: 52, borderWidth: 2, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.body, fontSize: 17, textAlign: "center" },
});
