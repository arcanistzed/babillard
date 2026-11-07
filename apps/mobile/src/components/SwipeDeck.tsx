import * as Haptics from "expo-haptics";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type ReactNode } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { fonts } from "@/theme";

export type SwipeDirection = "right" | "left";

export interface SwipeDeckHandle {
  swipe: (direction: SwipeDirection) => void;
}

interface SwipeDeckProps<T> {
  items: T[];
  keyOf: (item: T) => string;
  /** `pull` runs from 0 to 1 as the card is dragged right toward its threshold. */
  renderCard: (item: T, isTop: boolean, pull: SharedValue<number>) => ReactNode;
  describeCard: (item: T) => string;
  onSwipe: (item: T, direction: SwipeDirection) => void;
  rightLabel: string;
  leftLabel: string;
  stampInk?: (item: T) => string;
}

const VELOCITY_TRIGGER = 900;
const SPRING = { damping: 18, stiffness: 220, mass: 0.7 };

function DeckCard<T>({
  item,
  isTop,
  progress,
  register,
  rightLabel,
  leftLabel,
  renderCard,
  describeCard,
  onDone,
}: {
  item: T;
  isTop: boolean;
  progress: SharedValue<number>;
  register: (fn: ((direction: SwipeDirection) => void) | null) => void;
  rightLabel: string;
  leftLabel: string;
  renderCard: (item: T, isTop: boolean, pull: SharedValue<number>) => ReactNode;
  describeCard: (item: T) => string;
  onDone: (direction: SwipeDirection) => void;
}) {
  const { width } = useWindowDimensions();
  const threshold = width * 0.28;
  const offscreen = width * 1.4;
  const reducedMotion = useReducedMotion();
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const passedThreshold = useSharedValue(false);
  const pull = useDerivedValue(() => Math.max(Math.min(translateX.value / threshold, 1), 0));

  const tick = useCallback(() => void Haptics.selectionAsync().catch(() => undefined), []);

  const fling = useCallback(
    (direction: SwipeDirection) => {
      "worklet";
      const target = direction === "right" ? offscreen : -offscreen;
      progress.value = withTiming(1, { duration: 180 });
      translateX.value = withTiming(target, { duration: reducedMotion ? 80 : 200 }, (finished) => {
        if (finished) scheduleOnRN(onDone, direction);
      });
    },
    [offscreen, onDone, progress, reducedMotion, translateX],
  );

  useEffect(() => {
    if (!isTop) return;
    register((direction) => fling(direction));
    return () => register(null);
  }, [fling, isTop, register]);

  const pan = usePanGesture({
    enabled: isTop,
    activeOffsetX: [-12, 12],
    failOffsetY: [-24, 24],
    onUpdate: (event) => {
      "worklet";
      translateX.value = event.translationX;
      translateY.value = event.translationY * 0.25;
      progress.value = Math.min(Math.abs(event.translationX) / threshold, 1);
      const passed = Math.abs(event.translationX) > threshold;
      if (passed !== passedThreshold.value) {
        passedThreshold.value = passed;
        scheduleOnRN(tick);
      }
    },
    onDeactivate: (event) => {
      "worklet";
      passedThreshold.value = false;
      const thrown = Math.abs(event.velocityX) > VELOCITY_TRIGGER;
      if (Math.abs(event.translationX) > threshold || thrown) {
        fling((thrown ? event.velocityX : event.translationX) > 0 ? "right" : "left");
      } else {
        translateX.value = withSpring(0, SPRING);
        translateY.value = withSpring(0, SPRING);
        progress.value = withSpring(0, SPRING);
      }
    },
  });

  const cardStyle = useAnimatedStyle(() => {
    const scale = isTop ? 1 : interpolate(progress.value, [0, 1], [0.95, 1], Extrapolation.CLAMP);
    const rest = isTop ? 0 : interpolate(progress.value, [0, 1], [-1.6, 0], Extrapolation.CLAMP);
    const rotate = reducedMotion ? rest : rest + interpolate(translateX.value, [-width, width], [-12, 12]);
    return { transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { rotate: `${rotate}deg` }, { scale }] };
  });
  const rightStamp = useAnimatedStyle(() => ({ opacity: interpolate(translateX.value, [threshold * 0.25, threshold], [0, 1], Extrapolation.CLAMP) }));
  const leftStamp = useAnimatedStyle(() => ({ opacity: interpolate(translateX.value, [-threshold, -threshold * 0.25], [1, 0], Extrapolation.CLAMP) }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[StyleSheet.absoluteFill, cardStyle]}
        accessible={isTop ? undefined : false}
        accessibilityElementsHidden={!isTop}
        importantForAccessibility={isTop ? "auto" : "no-hide-descendants"}
        accessibilityLabel={isTop ? describeCard(item) : undefined}
        accessibilityActions={
          isTop
            ? [
                { name: "activate", label: rightLabel },
                { name: "escape", label: leftLabel },
              ]
            : undefined
        }
        onAccessibilityAction={(event) => fling(event.nativeEvent.actionName === "activate" ? "right" : "left")}
      >
        {renderCard(item, isTop, pull)}
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampRight, rightStamp]}>
          <Text style={styles.stampText}>{rightLabel}</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampLeft, leftStamp]}>
          <Text style={styles.stampText}>{leftLabel}</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

function SwipeDeckInner<T>({ items, keyOf, renderCard, describeCard, onSwipe, rightLabel, leftLabel }: SwipeDeckProps<T>, ref: React.ForwardedRef<SwipeDeckHandle>) {
  const progress = useSharedValue(0);
  const topFling = useRef<((direction: SwipeDirection) => void) | null>(null);
  const register = useCallback((fn: ((direction: SwipeDirection) => void) | null) => {
    topFling.current = fn;
  }, []);

  useImperativeHandle(ref, () => ({ swipe: (direction) => topFling.current?.(direction) }), []);

  const visible = items.slice(0, 2).reverse();
  const top = items[0];

  return (
    <View style={styles.deck}>
      {visible.map((item) => (
        <DeckCard
          key={keyOf(item)}
          item={item}
          isTop={item === top}
          progress={progress}
          register={register}
          rightLabel={rightLabel}
          leftLabel={leftLabel}
          renderCard={renderCard}
          describeCard={describeCard}
          onDone={(direction) => {
            void Haptics.impactAsync(direction === "right" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
            progress.value = 0;
            onSwipe(item, direction);
          }}
        />
      ))}
    </View>
  );
}

export const SwipeDeck = forwardRef(SwipeDeckInner) as <T>(props: SwipeDeckProps<T> & { ref?: React.Ref<SwipeDeckHandle> }) => ReactNode;

const styles = StyleSheet.create({
  deck: { flex: 1 },
  stamp: { position: "absolute", top: 34, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 4, borderRadius: 8, borderColor: "#15173D", backgroundColor: "#FFFFFF" },
  stampRight: { left: 20, transform: [{ rotate: "-9deg" }] },
  stampLeft: { right: 20, transform: [{ rotate: "9deg" }] },
  stampText: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: "#15173D" },
});
