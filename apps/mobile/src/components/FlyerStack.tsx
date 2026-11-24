import { StyleSheet, Text, View } from "react-native";
import { t } from "@/i18n";
import { flyerInk, fonts } from "@/theme";

const FLYERS = [
  { field: "urbanism", title: t("Walkable cities", "Villes marchables"), rotate: "-6deg", left: "0%", top: 30, missing: 2 },
  { field: "psychology", title: t("Loneliness", "La solitude"), rotate: "6deg", left: "64%", top: 22, missing: 4 },
  { field: "economics", title: t("The four-day work week", "La semaine de quatre jours"), rotate: "-1deg", left: "32%", top: 0, missing: 3 },
] as const;
const TABS = 6;

/** The app's flyers, as a picture on the sign-in screen. Only decoration, so screen readers skip it. */
export function FlyerStack() {
  return (
    <View style={styles.stack} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {FLYERS.map(({ field, title, rotate, left, top, missing }) => {
        const { bg, fg } = flyerInk(field);
        return (
          <View key={field} style={[styles.flyer, { left, top, transform: [{ rotate }] }]}>
            <View style={[styles.sheet, { backgroundColor: bg }]}>
              <Text allowFontScaling={false} style={[styles.title, { color: fg }]}>
                {title}
              </Text>
            </View>
            <View style={styles.tabs}>
              {Array.from({ length: TABS }, (_, index) => (
                <View key={index} style={[styles.tab, index < missing ? null : { backgroundColor: bg }]} />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { height: 216 },
  flyer: { position: "absolute", width: "36%" },
  // Extra room on the left, where the middle flyer covers the one behind it.
  sheet: { height: 150, padding: 10, paddingLeft: 20, justifyContent: "center", borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  title: { fontFamily: fonts.display, fontSize: 16, lineHeight: 19 },
  tabs: { flexDirection: "row", gap: 1, height: 20 },
  tab: { flex: 1, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
});
