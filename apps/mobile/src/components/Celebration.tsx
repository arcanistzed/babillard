import { Modal, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fonts } from "@/theme";
import { Button } from "@/ui";

const INK = "#15173D";
const PINK = "#FF5FAE";

/** The one big moment in the app: a match or a new group. It offers one next step, which is to go talk. */
export function Celebration({ title, body, action, onAction, onDismiss, dismissLabel }: { title: string; body: string; action: string; onAction: () => void; onDismiss: () => void; dismissLabel: string }) {
  return (
    <Modal animationType="slide" onRequestClose={onDismiss} statusBarTranslucent>
      <SafeAreaView style={styles.screen}>
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Text style={styles.body}>{body}</Text>
        </View>
        <View style={styles.actions}>
          <Button label={action} onPress={onAction} style={styles.primary} />
          <Button label={dismissLabel} kind="secondary" onPress={onDismiss} style={styles.secondary} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: PINK, padding: 24 },
  copy: { flex: 1, justifyContent: "center", gap: 16 },
  title: { fontFamily: fonts.display, fontSize: 60, lineHeight: 62, color: INK },
  body: { fontFamily: fonts.body, fontSize: 20, lineHeight: 28, color: INK },
  actions: { gap: 10 },
  primary: { backgroundColor: INK, borderColor: INK },
  secondary: { borderColor: INK },
});
