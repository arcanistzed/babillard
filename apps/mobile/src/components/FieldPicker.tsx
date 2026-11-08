import { FIELD_GROUPS, type Field } from "@babillard/shared";
import { StyleSheet, View } from "react-native";
import { fieldGroupLabel, fieldLabel } from "@/i18n";
import { Chip, ChipRow, T } from "@/ui";

/** Fields under broad headings, since 26 chips in one block are hard to scan. */
export function FieldPicker({ value, onChange, max }: { value: Field[]; onChange: (next: Field[]) => void; max: number }) {
  return (
    <View style={styles.groups}>
      {FIELD_GROUPS.map((group) => (
        <View key={group.id} style={styles.group}>
          <T variant="small" muted accessibilityRole="header">
            {fieldGroupLabel(group.id)}
          </T>
          <ChipRow>
            {group.fields.map((field) => {
              const selected = value.includes(field);
              return (
                <Chip
                  key={field}
                  label={fieldLabel(field)}
                  selected={selected}
                  disabled={!selected && value.length >= max}
                  onPress={() => onChange(selected ? value.filter((item) => item !== field) : [...value, field])}
                />
              );
            })}
          </ChipRow>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  groups: { gap: 14 },
  group: { gap: 6 },
});
