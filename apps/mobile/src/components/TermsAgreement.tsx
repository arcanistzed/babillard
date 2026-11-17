import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { haptics } from "@/haptics";
import { t } from "@/i18n";
import { openLegalPage } from "@/legal";
import { fonts, useTheme } from "@/theme";
import { T } from "@/ui";

/**
 * The whole sentence ticks the box. The two documents open from links of their own underneath,
 * since links inside a sentence can't be made big enough to tap reliably.
 */
export function TermsAgreement({ agreed, onChange }: { agreed: boolean; onChange: (agreed: boolean) => void }) {
  const theme = useTheme();
  const link = { color: theme.accent, fontFamily: fonts.bodyBold, textDecorationLine: "underline" } as const;
  return (
    <View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed }}
        onPress={() => {
          haptics.select();
          onChange(!agreed);
        }}
        style={styles.row}
      >
        <Ionicons name={agreed ? "checkbox" : "square-outline"} size={28} color={agreed ? theme.accent : theme.ink} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        <T style={styles.text}>{t("I agree to the Terms of use and Privacy policy.", "J'accepte les Conditions d'utilisation et la Politique de confidentialité.")}</T>
      </Pressable>
      <View style={styles.links}>
        <Pressable accessibilityRole="link" onPress={() => openLegalPage("terms")} style={styles.link}>
          <T style={link}>{t("Terms of use", "Conditions d'utilisation")}</T>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => openLegalPage("privacy")} style={styles.link}>
          <T style={link}>{t("Privacy policy", "Politique de confidentialité")}</T>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, alignItems: "center", minHeight: 44 },
  text: { flex: 1 },
  // Lined up under the sentence, past the checkbox.
  links: { flexDirection: "row", flexWrap: "wrap", columnGap: 18, paddingLeft: 38 },
  link: { minHeight: 44, justifyContent: "center" },
});
