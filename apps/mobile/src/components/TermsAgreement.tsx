import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { haptics } from "@/haptics";
import { t } from "@/i18n";
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
        accessibilityLabel={t("I'm 18 or older, and I agree to the Terms of use and Privacy policy", "J'ai 18 ans ou plus, et j'accepte les Conditions d'utilisation et la Politique de confidentialité")}
        hitSlop={8}
        onPress={() => {
          haptics.select();
          onChange(!agreed);
        }}
      >
        <Ionicons name={agreed ? "checkbox" : "square-outline"} size={28} color={agreed ? theme.accent : theme.ink} />
      </Pressable>
      <T style={styles.text}>
        {t("I'm 18 or older, and I agree to the", "J'ai 18 ans ou plus, et j'accepte les")}{" "}
        <T accessibilityRole="link" style={link} onPress={() => openLegalPage("terms")}>
          {t("Terms of use", "Conditions d'utilisation")}
        </T>{" "}
        {t("and", "et la")}{" "}
        <T accessibilityRole="link" style={link} onPress={() => openLegalPage("privacy")}>
          {t("Privacy policy", "Politique de confidentialité")}
        </T>
        .
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  text: { flex: 1 },
});
