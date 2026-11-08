import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type PressableProps, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle } from "react-native";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { useContext, useEffect, useState, type ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { haptics } from "./haptics";
import { fonts, useTheme } from "./theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const SETTLE = { damping: 14, stiffness: 320, mass: 0.6 };

type Variant = "display" | "title" | "heading" | "body" | "bodyBold" | "small";

const VARIANTS: Record<Variant, TextStyle> = {
  display: { fontFamily: fonts.display, fontSize: 38, lineHeight: 42 },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 31 },
  heading: { fontFamily: fonts.displayMedium, fontSize: 19, lineHeight: 25 },
  body: { fontFamily: fonts.body, fontSize: 17, lineHeight: 25 },
  bodyBold: { fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 25 },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
};

export function T({ variant = "body", muted, style, ...props }: TextProps & { variant?: Variant; muted?: boolean }) {
  const theme = useTheme();
  const isHeader = variant === "display" || variant === "title" || variant === "heading";
  return <Text accessibilityRole={isHeader ? "header" : undefined} {...props} style={[VARIANTS[variant], { color: muted ? theme.muted : theme.ink }, style]} />;
}

interface ButtonProps extends Omit<PressableProps, "style" | "children"> {
  label: string;
  kind?: "primary" | "secondary" | "quiet" | "danger";
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  /** For screens with their own fixed colours, where the theme's text colour could vanish against them. */
  textColor?: string;
}

export function Button({ label, kind = "primary", busy, disabled, style, textColor, onPressIn, onPressOut, ...props }: ButtonProps) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const colors = {
    primary: { bg: theme.accent, fg: theme.onAccent, border: theme.accent },
    secondary: { bg: "transparent", fg: theme.ink, border: theme.ink },
    quiet: { bg: "transparent", fg: theme.ink, border: "transparent" },
    danger: { bg: "transparent", fg: theme.danger, border: theme.danger },
  }[kind];
  const inactive = disabled || busy;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      disabled={inactive}
      onPressIn={(event) => {
        scale.value = withTiming(0.97, { duration: 80 });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withSpring(1, SETTLE);
        onPressOut?.(event);
      }}
      {...props}
      style={[styles.button, { backgroundColor: colors.bg, borderColor: colors.border, opacity: inactive ? 0.5 : 1 }, pressStyle, style]}
    >
      {busy ? <ActivityIndicator color={textColor ?? colors.fg} /> : <Text style={[VARIANTS.bodyBold, { color: textColor ?? colors.fg }]}>{label}</Text>}
    </AnimatedPressable>
  );
}

export function Chip({ label, selected, onPress, disabled }: { label: string; selected?: boolean; onPress?: () => void; disabled?: boolean }) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      accessibilityRole={onPress ? "checkbox" : "text"}
      accessibilityState={{ checked: !!selected, disabled: !!disabled }}
      onPress={
        onPress &&
        (() => {
          haptics.select();
          scale.value = withSequence(withTiming(1.06, { duration: 70 }), withSpring(1, SETTLE));
          onPress();
        })
      }
      disabled={disabled || !onPress}
      hitSlop={4}
      style={[styles.chip, { borderColor: selected ? theme.ink : theme.line, backgroundColor: selected ? theme.ink : "transparent", opacity: disabled ? 0.45 : 1 }, popStyle]}
    >
      <Text style={[VARIANTS.small, { fontFamily: fonts.bodyBold, color: selected ? theme.paper : theme.ink }]}>{label}</Text>
    </AnimatedPressable>
  );
}

export function ChipRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.chipRow, style]}>{children}</View>;
}

export function Field({ label, error, style, trailing, ...props }: TextInputProps & { label: string; error?: string | null; trailing?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <T variant="bodyBold">{label}</T>
      <View>
        <TextInput
          placeholderTextColor={theme.muted}
          accessibilityLabel={label}
          {...props}
          style={[VARIANTS.body, styles.input, { color: theme.ink, borderColor: error ? theme.danger : theme.ink, backgroundColor: theme.surface }, trailing ? styles.inputWithTrailing : null, style]}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {error ? <T variant="small" style={{ color: theme.danger }}>{error}</T> : null}
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <T accessibilityLiveRegion="polite" style={{ color: theme.danger }}>
      {children}
    </T>
  );
}

export function Avatar({ name, url, size = 44, tint }: { name: string; url?: string | null; size?: number; tint?: { bg: string; fg: string } }) {
  const theme = useTheme();
  const colors = tint ?? { bg: theme.line, fg: theme.ink };
  if (url) {
    return <Image source={url} accessibilityLabel={`Photo of ${name}`} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.bg }} />;
  }
  return (
    <View accessible accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: fonts.display, fontSize: size * 0.45, color: colors.fg }}>{name.trim().charAt(0).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 52, paddingHorizontal: 20, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  chip: { minHeight: 36, paddingHorizontal: 13, alignSelf: "flex-start", justifyContent: "center", borderRadius: 18, borderWidth: 1.5 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  field: { gap: 6 },
  inputWithTrailing: { paddingRight: 52 },
  trailing: { position: "absolute", top: 0, bottom: 0, right: 4, width: 44, alignItems: "center", justifyContent: "center" },
  keyboardScreen: { flex: 1 },
  input: { minHeight: 52, borderWidth: 2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
});

/**
 * Android apps now draw edge to edge, so the system no longer resizes them for
 * the keyboard. Every screen with a text field goes in here so its buttons stay
 * above the keyboard on both platforms.
 */
export function KeyboardScreen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={[styles.keyboardScreen, style]}>
      {children}
    </KeyboardAvoidingView>
  );
}

/** A form whose submit button sits right after its fields, clear of the Android navigation bar. */
export function FormScreen({ children, gap = 16 }: { children: ReactNode; gap?: number }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 20 + insets.bottom, gap }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </KeyboardScreen>
  );
}

export function useKeyboardOpen(): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return keyboardOpen;
}

/** Height of the safe area below content, dropped while the keyboard is up since the keyboard already covers it. */
export function useBottomPadding(minimum = 8): number {
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardOpen();
  return keyboardOpen ? minimum : Math.max(insets.bottom, minimum);
}
