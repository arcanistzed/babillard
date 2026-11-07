import { FIELD_LABELS, GROUP_MAX_SIZE, GROUP_MIN_SIZE, type Field, type Stance, type TopicCard } from "@ideas-match/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { fonts, flyerInk } from "@/theme";

const STANCE_LABELS: Record<Stance, string> = { for: "For", against: "Against", unsure: "Not sure" };

function nearbyLine(count: number): string | null {
  if (count === 0) return null;
  if (count === GROUP_MIN_SIZE - 1) return `${count} nearby. You'd open the group.`;
  return `${count} nearby`;
}

/**
 * A campus flyer with tear-off tabs. Each tab is a seat in a group, and each
 * missing one is someone nearby who's already in. Dragging the card right tears
 * off the next tab, which is the seat this person would take.
 */
function TearOffTabs({ nearby, bg, pull }: { nearby: number; bg: string; pull?: SharedValue<number> }) {
  const tearStyle = useAnimatedStyle(() => {
    const amount = pull ? interpolate(pull.value, [0.3, 1], [0, 1], Extrapolation.CLAMP) : 0;
    return { opacity: 1 - amount, transform: [{ translateY: amount * 44 }, { rotate: `${amount * 16}deg` }] };
  });
  return (
    <View style={styles.tabs} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: GROUP_MAX_SIZE }, (_, index) => (
        <View key={index} style={styles.tab}>
          <View style={[styles.tornStub, { backgroundColor: bg }]} />
          {index >= nearby ? <Animated.View style={[styles.tabPaper, { backgroundColor: bg }, index === nearby ? tearStyle : null]} /> : null}
        </View>
      ))}
    </View>
  );
}

export function Flyer({ topic, stance, onStance, isTop = true, pull }: { topic: TopicCard; stance: Stance | null; onStance: (stance: Stance | null) => void; isTop?: boolean; pull?: SharedValue<number> }) {
  const { bg, fg } = flyerInk(topic.fieldTags[0]);
  const fields = topic.fieldTags.map((tag) => FIELD_LABELS[tag as Field] ?? tag).join(" and ");
  const isQuestion = topic.kind === "question";
  const nearby = topic.pending ? "In review" : nearbyLine(topic.nearbyCount);
  const titleSize = topic.title.length > 48 ? 32 : topic.title.length > 26 ? 38 : 46;

  return (
    <View style={styles.flyer} accessible={false}>
      <View style={[styles.sheet, { backgroundColor: bg }]}>
        {isQuestion ? (
          <Text style={[styles.questionMark, { color: fg }]} accessibilityElementsHidden importantForAccessibility="no">
            ?
          </Text>
        ) : null}
        <Text style={[styles.fields, { color: fg }]}>{fields}</Text>
        <View style={styles.middle}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.2} adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={7} style={[styles.title, { color: fg, fontSize: titleSize, lineHeight: titleSize * 1.04 }]}>
            {topic.title}
          </Text>
          {topic.blurb ? <Text maxFontSizeMultiplier={1.3} numberOfLines={5} style={[styles.blurb, { color: fg }]}>{topic.blurb}</Text> : null}
        </View>

        {isQuestion ? (
          <View style={styles.stances}>
            <View style={styles.stanceRow}>
              {(Object.keys(STANCE_LABELS) as Stance[]).map((value) => {
                const selected = stance === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={STANCE_LABELS[value]}
                    onPress={() => onStance(selected ? null : value)}
                    style={[styles.stance, { borderColor: fg, backgroundColor: selected ? fg : "transparent" }]}
                  >
                    <Text style={[styles.stanceText, { color: selected ? bg : fg }]}>{STANCE_LABELS[value]}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {nearby ? <Text style={[styles.nearby, { color: fg }]}>{nearby}</Text> : null}
      </View>
      {/* The card underneath keeps its tabs hidden, or they'd show through the top card's torn ones. */}
      <View style={isTop ? null : styles.hidden}>
        {/* One tab always stays on: a popular topic just starts another group, so there's always room. */}
        <TearOffTabs nearby={topic.pending ? 0 : Math.min(topic.nearbyCount, GROUP_MAX_SIZE - 1)} bg={bg} pull={pull} />
      </View>
    </View>
  );
}

const TAB_HEIGHT = 40;

const styles = StyleSheet.create({
  flyer: { flex: 1 },
  hidden: { opacity: 0 },
  sheet: { flex: 1, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 14, overflow: "hidden", borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  questionMark: { position: "absolute", right: -18, top: -66, fontFamily: fonts.display, fontSize: 300, lineHeight: 340, opacity: 0.14 },
  fields: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20 },
  middle: { flex: 1, justifyContent: "center", gap: 12 },
  title: { fontFamily: fonts.display },
  blurb: { fontFamily: fonts.body, fontSize: 18, lineHeight: 25 },
  stances: { marginBottom: 12 },
  stanceRow: { flexDirection: "row", gap: 8 },
  stance: { flex: 1, minHeight: 44, borderWidth: 2, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  stanceText: { fontFamily: fonts.bodyBold, fontSize: 15 },
  nearby: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20 },
  tabs: { flexDirection: "row", height: TAB_HEIGHT, gap: 2 },
  tab: { flex: 1 },
  tabPaper: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  tornStub: { position: "absolute", top: 0, left: 0, right: 0, height: 4 },
});
