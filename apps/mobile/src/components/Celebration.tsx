import { useEffect } from "react";
import { Modal, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, interpolate, useAnimatedStyle, useSharedValue, withDelay, withTiming, ZoomIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { haptics } from "@/haptics";
import { fonts } from "@/theme";
import { Button } from "@/ui";

const INK = "#15173D";
const PINK = "#FF5FAE";
const TAB_COLORS = [INK, "#FFFFFF", "#FFC21A"];
const TAB_COUNT = 16;

/** A tab torn off a flyer, falling past the screen. With reduced motion on, Reanimated jumps to the end of the fall, where it's out of sight. */
function FallingTab({ index }: { index: number }) {
  const { width, height } = useWindowDimensions();
  const fall = useSharedValue(0);
  // Fixed offsets, so the spread looks scattered but never bunches up by chance.
  const left = (((index * 37) % 100) / 100) * width;
  const spin = index % 2 === 0 ? 300 : -260;

  useEffect(() => {
    fall.value = withDelay((index * 53) % 450, withTiming(1, { duration: 1500 + ((index * 97) % 800), easing: Easing.in(Easing.quad) }));
  }, [fall, index]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(fall.value, [0, 1], [-60, height + 200]) }, { rotate: `${fall.value * spin}deg` }],
  }));

  return <Animated.View pointerEvents="none" style={[styles.tab, { left, backgroundColor: TAB_COLORS[index % TAB_COLORS.length] }, style]} />;
}

/** The one big moment in the app: a match or a new group. It offers one next step, which is to go talk. */
export function Celebration({ title, body, action, onAction, onDismiss, dismissLabel }: { title: string; body: string; action: string; onAction: () => void; onDismiss: () => void; dismissLabel: string }) {
  useEffect(() => haptics.celebrate(), []);

  return (
    <Modal animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <SafeAreaView style={styles.screen}>
        {Array.from({ length: TAB_COUNT }, (_, index) => (
          <FallingTab key={index} index={index} />
        ))}
        <View style={styles.copy}>
          <Animated.Text entering={ZoomIn.springify().damping(13)} accessibilityRole="header" style={styles.title}>
            {title}
          </Animated.Text>
          <Animated.Text entering={FadeIn.delay(180).duration(240)} style={styles.body}>
            {body}
          </Animated.Text>
        </View>
        <Animated.View entering={FadeInDown.delay(260).duration(260)} style={styles.actions}>
          <Button label={action} onPress={onAction} style={styles.primary} textColor={PINK} />
          <Button label={dismissLabel} kind="secondary" onPress={onDismiss} style={styles.secondary} textColor={INK} />
        </Animated.View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: PINK, padding: 24 },
  tab: { position: "absolute", top: 0, width: 16, height: 40, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  copy: { flex: 1, justifyContent: "center", gap: 16 },
  title: { fontFamily: fonts.display, fontSize: 60, lineHeight: 62, color: INK },
  body: { fontFamily: fonts.body, fontSize: 20, lineHeight: 28, color: INK },
  actions: { gap: 10 },
  primary: { backgroundColor: INK, borderColor: INK },
  secondary: { borderColor: INK },
});
