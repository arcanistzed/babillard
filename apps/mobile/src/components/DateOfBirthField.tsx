import { isAdult } from "@babillard/shared";
import { type ComponentRef, type ReactNode, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { t } from "@/i18n";
import { fonts, useTheme } from "@/theme";
import { T } from "@/ui";

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** The date as YYYY-MM-DD, or null if the parts don't make a real date. */
function toIsoDate(day: string, month: string, year: string): string | null {
  if (!day || !month || year.length !== 4) return null;
  const [d, m, y] = [Number(day), Number(month), Number(year)];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Day, month, and year in their own boxes, moving to the next box once one is full. Reports the
 * date as YYYY-MM-DD when it's a real date of someone 18 or over, and "" otherwise.
 */
export function DateOfBirthField({ onChange }: { onChange: (dob: string) => void }) {
  const theme = useTheme();
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const monthRef = useRef<ComponentRef<typeof TextInput>>(null);
  const yearRef = useRef<ComponentRef<typeof TextInput>>(null);

  const iso = toIsoDate(day, month, year);
  const complete = Boolean(day && month && year.length === 4);
  const error = !complete ? null : !iso ? t("That date doesn't exist.", "Cette date n'existe pas.") : !isAdult(iso) ? t("Babillard is for people 18 and over.", "Babillard est réservé aux personnes de 18 ans et plus.") : null;

  function update(next: { day?: string; month?: string; year?: string }) {
    const parts = { day, month, year, ...next };
    const nextIso = toIsoDate(parts.day, parts.month, parts.year);
    onChange(nextIso && isAdult(nextIso) ? nextIso : "");
  }

  const box = (width: number) => [styles.input, { width, color: theme.ink, borderColor: error ? theme.danger : theme.ink, backgroundColor: theme.surface }];
  const part = (label: string, input: ReactNode) => (
    <View style={styles.part}>
      <T variant="small" muted>
        {label}
      </T>
      {input}
    </View>
  );

  return (
    <View style={styles.field}>
      <T variant="bodyBold">{t("Date of birth", "Date de naissance")}</T>
      <View style={styles.row}>
        {part(
          t("Day", "Jour"),
          <TextInput
            value={day}
            onChangeText={(value) => {
              const digits = value.replace(/\D/g, "").slice(0, 2);
              setDay(digits);
              update({ day: digits });
              if (digits.length === 2 || Number(digits) > 3) monthRef.current?.focus();
            }}
            keyboardType="number-pad"
            maxLength={2}
            placeholder={t("DD", "JJ")}
            placeholderTextColor={theme.muted}
            accessibilityLabel={t("Day of birth", "Jour de naissance")}
            autoComplete="birthdate-day"
            style={box(64)}
          />,
        )}
        {part(
          t("Month", "Mois"),
          <TextInput
            ref={monthRef}
            value={month}
            onChangeText={(value) => {
              const digits = value.replace(/\D/g, "").slice(0, 2);
              setMonth(digits);
              update({ month: digits });
              if (digits.length === 2 || Number(digits) > 1) yearRef.current?.focus();
            }}
            keyboardType="number-pad"
            maxLength={2}
            placeholder={t("MM", "MM")}
            placeholderTextColor={theme.muted}
            accessibilityLabel={t("Month of birth, as a number", "Mois de naissance, en chiffres")}
            autoComplete="birthdate-month"
            style={box(64)}
          />,
        )}
        {part(
          t("Year", "Année"),
          <TextInput
            ref={yearRef}
            value={year}
            onChangeText={(value) => {
              const digits = value.replace(/\D/g, "").slice(0, 4);
              setYear(digits);
              update({ year: digits });
            }}
            keyboardType="number-pad"
            maxLength={4}
            placeholder={t("YYYY", "AAAA")}
            placeholderTextColor={theme.muted}
            accessibilityLabel={t("Year of birth", "Année de naissance")}
            autoComplete="birthdate-year"
            style={box(92)}
          />,
        )}
      </View>
      {error ? (
        <T variant="small" accessibilityLiveRegion="polite" style={{ color: theme.danger }}>
          {error}
        </T>
      ) : iso ? (
        <T variant="small" muted>
          {t(`${MONTHS_EN[Number(month) - 1]} ${Number(day)}, ${year}`, `${Number(day)} ${MONTHS_FR[Number(month) - 1]} ${year}`)}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  row: { flexDirection: "row", gap: 10 },
  part: { gap: 4 },
  input: { minHeight: 52, borderWidth: 2, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.body, fontSize: 17, textAlign: "center" },
});
