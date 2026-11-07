import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { haptics } from "@/haptics";
import { openLegalPage } from "@/legal";
import { fonts, useTheme } from "@/theme";
import { T } from "@/ui";

export function TermsAgreement({ agreed, onChange }: { agreed: boolean; onChange: (agreed: boolean) => void }) {
  const theme = useTheme();
  const link = { color: theme.accent, fontFamily: fonts.bodyBold, textDecorationLine: "underline" } as const;
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed }}
        accessibilityLabel="I'm 18 or older, and I agree to the Terms of use and Privacy policy"
        hitSlop={8}
        onPress={() => {
          haptics.select();
          onChange(!agreed);
        }}
      >
        <Ionicons name={agreed ? "checkbox" : "square-outline"} size={28} color={agreed ? theme.accent : theme.ink} />
      </Pressable>
      <T style={styles.text}>
        I'm 18 or older, and I agree to the{" "}
        <T accessibilityRole="link" style={link} onPress={() => openLegalPage("terms")}>
          Terms of use
        </T>{" "}
        and{" "}
        <T accessibilityRole="link" style={link} onPress={() => openLegalPage("privacy")}>
          Privacy policy
        </T>
        , including how my date of birth and other sensitive details are used.
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  text: { flex: 1 },
});
