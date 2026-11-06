import { LOOKING_FOR, LOOKING_FOR_LABELS, type LookingFor } from "@ideas-match/shared";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme";
import { Chip, ChipRow, T } from "@/ui";

const PRIVATE_OPTION: LookingFor = "more_than_friends";

/** The private option sits in its own box with its note, so the note can't be mistaken for one about the others. */
export function LookingForPicker({ value, onChange }: { value: LookingFor[]; onChange: (next: LookingFor[]) => void }) {
  const theme = useTheme();
  const toggle = (item: LookingFor) => onChange(value.includes(item) ? value.filter((other) => other !== item) : [...value, item]);

  return (
    <View style={styles.picker}>
      <ChipRow>
        {LOOKING_FOR.filter((item) => item !== PRIVATE_OPTION).map((item) => (
          <Chip key={item} label={LOOKING_FOR_LABELS[item]} selected={value.includes(item)} onPress={() => toggle(item)} />
        ))}
      </ChipRow>
      <View style={[styles.privateBox, { borderColor: theme.line, backgroundColor: theme.surface }]}>
        <ChipRow>
          <Chip label={LOOKING_FOR_LABELS[PRIVATE_OPTION]} selected={value.includes(PRIVATE_OPTION)} onPress={() => toggle(PRIVATE_OPTION)} />
        </ChipRow>
        <T variant="small" muted>
          Only shown to people who also choose this.
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { gap: 14 },
  privateBox: { gap: 8, padding: 12, borderWidth: 1.5, borderRadius: 12 },
});
