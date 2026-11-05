import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Pressable, StyleSheet } from "react-native";
import { Avatar, T } from "@/ui";

const AVATAR_SIZE = 640;

/** Square-crops and shrinks on the phone. The server only stores the result. */
export async function pickAndResizePhoto(): Promise<string | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (!asset) return null;
  const context = ImageManipulator.manipulate(asset.uri);
  context.resize({ width: AVATAR_SIZE });
  const image = await context.renderAsync();
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return result.uri;
}

export function PhotoPicker({ name, uri, onPress }: { name: string; uri: string | null; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Choose a photo" onPress={onPress} style={styles.row}>
      <Avatar name={name || "?"} url={uri} size={88} />
      <T variant="bodyBold">{uri ? "Change photo" : "Choose a photo"}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 88 },
});
