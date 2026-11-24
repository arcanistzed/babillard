import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type PressableProps, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewProps, type ViewStyle } from "react-native";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { useContext, useEffect, useState, type ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { topicInitial } from "@babillard/shared";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { haptics } from "./haptics";
import { t } from "./i18n";
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
  // Half opacity made disabled buttons muddy and hard to read, so they get their own readable neutral colours.
  const shown = disabled && !busy ? { bg: kind === "primary" ? theme.line : "transparent", fg: theme.muted, border: theme.line } : colors;
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
      style={[styles.button, { backgroundColor: shown.bg, borderColor: shown.border }, pressStyle, style]}
    >
      {busy ? <ActivityIndicator color={textColor ?? shown.fg} /> : <Text style={[VARIANTS.bodyBold, styles.buttonLabel, { color: disabled ? shown.fg : (textColor ?? shown.fg) }]}>{label}</Text>}
    </AnimatedPressable>
  );
}

/**
 * A tappable chip says what kind of control it is: one of several picks (checkbox), one choice in a
 * radiogroup (radio), or an action (button, whose label should say what tapping does). Without
 * `onPress` it's a plain label.
 */
type ChipProps = { label: string; selected?: boolean; disabled?: boolean; accessibilityLabel?: string; accessibilityHint?: string } & (
  | { onPress?: undefined; role?: undefined }
  | { onPress: () => void; role: "checkbox" | "radio" | "button" }
);

export function Chip({ label, selected, onPress, disabled, role, accessibilityLabel, accessibilityHint }: ChipProps) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  // A plain label is a filled tag without an edge, so only the chips that do something look tappable.
  const look = onPress
    ? [styles.chip, { borderColor: selected ? theme.ink : theme.control, backgroundColor: selected ? theme.ink : theme.surface, opacity: disabled ? 0.45 : 1 }]
    : [styles.chip, { borderColor: theme.line, backgroundColor: theme.line }];
  const text = <Text style={[VARIANTS.small, { fontFamily: fonts.bodyBold, color: selected ? theme.paper : theme.ink }]}>{label}</Text>;
  if (!onPress) {
    return (
      <View accessibilityLabel={accessibilityLabel} style={look}>
        {text}
      </View>
    );
  }
  return (
    <AnimatedPressable
      accessibilityRole={role}
      accessibilityState={role === "button" ? { disabled: !!disabled } : { checked: !!selected, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={() => {
        haptics.select();
        scale.value = withSequence(withTiming(1.06, { duration: 70 }), withSpring(1, SETTLE));
        onPress();
      }}
      disabled={disabled}
      hitSlop={4}
      style={[look, popStyle]}
    >
      {text}
    </AnimatedPressable>
  );
}

/** Pass accessibilityRole="radiogroup" when the chips inside are radios. */
export function ChipRow({ children, style, ...props }: ViewProps & { children: ReactNode }) {
  return (
    <View {...props} style={[styles.chipRow, style]}>
      {children}
    </View>
  );
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

/** What a screen shows when it can't load, with the one thing there is to do about it. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.loadError}>
      <ErrorText>{message}</ErrorText>
      <Button label={t("Try again", "Réessayer")} kind="secondary" onPress={onRetry} />
    </View>
  );
}

/** Rows boxed together, so a long list of them reads as a few groups. */
export function RowGroup({ title, children }: { title?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.rowGroup}>
      {title ? <T variant="heading">{title}</T> : null}
      <View style={[styles.rowBox, { backgroundColor: theme.surface, borderColor: theme.line }]}>{children}</View>
    </View>
  );
}

/** An arrow means the row opens a screen, or a page outside the app for a link. Rows that act on the spot, set with `acts`, have none. */
export function Row({ label, onPress, role = "button", acts, danger, first }: { label: string; onPress: () => void; role?: "button" | "link"; acts?: boolean; danger?: boolean; first?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line }, pressed ? { backgroundColor: theme.line } : null]}
    >
      <T variant="bodyBold" style={[styles.rowLabel, danger ? { color: theme.danger } : null]}>
        {label}
      </T>
      {acts ? null : <Ionicons name={role === "link" ? "open-outline" : "chevron-forward"} size={18} color={theme.muted} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />}
    </Pressable>
  );
}

/** A switch whose track shows up in both themes. The system's own one disappears on a dark background. */
export function Toggle({ label, value, onValueChange, disabled }: { label: string; value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean }) {
  const theme = useTheme();
  return <Switch accessibilityLabel={label} value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ false: theme.control, true: theme.accent }} thumbColor={Platform.OS === "android" ? "#FFFFFF" : undefined} />;
}

/** The buttons fixed under a form that scrolls, with a line so the form reads as going under them. */
export function ActionBar({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[styles.actionBar, { borderTopColor: theme.line, backgroundColor: theme.paper }, style]}>{children}</View>;
}

/** `topic` is for a group named after its topic, whose letter skips a leading article like "La" or "The". */
export function Avatar({ name, url, size = 44, tint, topic }: { name: string; url?: string | null; size?: number; tint?: { bg: string; fg: string }; topic?: boolean }) {
  const theme = useTheme();
  const colors = tint ?? { bg: theme.line, fg: theme.ink };
  if (url) {
    return <Image source={url} accessibilityLabel={t(`Photo of ${name}`, `Photo de ${name}`)} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.bg }} />;
  }
  return (
    <View accessible accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: fonts.display, fontSize: size * 0.45, color: colors.fg }}>{topic ? topicInitial(name) : name.trim().charAt(0).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 52, paddingHorizontal: 20, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  buttonLabel: { textAlign: "center" },
  loadError: { padding: 20, gap: 12 },
  rowGroup: { gap: 8 },
  rowBox: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 16, paddingVertical: 10 },
  rowLabel: { flex: 1 },
  actionBar: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8, gap: 4, borderTopWidth: StyleSheet.hairlineWidth },
  chip: { minHeight: 36, paddingHorizontal: 13, alignSelf: "flex-start", justifyContent: "center", borderRadius: 18, borderWidth: 1.5 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 4, marginVertical: -4 },
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

/** Padding for a screen that scrolls to the bottom edge, so its last control clears the Android navigation bar. */
export function useScrollPadding(padding = 20): { padding: number; paddingBottom: number } {
  const insets = useSafeAreaInsets();
  return { padding, paddingBottom: padding + insets.bottom };
}

/** Height of the safe area below content, dropped while the keyboard is up since the keyboard already covers it. */
export function useBottomPadding(minimum = 8): number {
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardOpen();
  return keyboardOpen ? minimum : Math.max(insets.bottom, minimum);
}
