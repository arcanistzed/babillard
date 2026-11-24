import { StyleSheet, View } from "react-native";
import { Button } from "@/ui";

export function DeckControls({ leftLabel, rightLabel, onLeft, onRight }: { leftLabel: string; rightLabel: string; onLeft: () => void; onRight: () => void }) {
  return (
    <View style={styles.row}>
      <Button label={leftLabel} kind="secondary" onPress={onLeft} style={styles.button} />
      <Button label={rightLabel} onPress={onRight} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  // Less side padding than usual, so "J'embarque" stays whole on a small screen with large text.
  button: { flex: 1, paddingHorizontal: 6 },
});
