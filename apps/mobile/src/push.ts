import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";
import { t } from "./i18n";

let registeredToken: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** Push is a nudge, never a requirement. Anything that goes wrong here leaves the rest of the app working. */
export async function registerForPush(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId) return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", { name: t("Matches and meetups", "Jumelages et rencontres"), importance: Notifications.AndroidImportance.HIGH });
    }
    const existing = await Notifications.getPermissionsAsync();
    const status = existing.granted ? existing : await Notifications.requestPermissionsAsync();
    if (!status.granted) return;

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    registeredToken = data;
    await api.post("/me/push-token", { token: data, platform: Platform.OS });
  } catch (error) {
    console.warn("Push registration failed", error);
  }
}

export async function unregisterPush(): Promise<void> {
  if (!registeredToken) return;
  await api.delete("/me/push-token", { token: registeredToken, platform: Platform.OS }).catch(() => undefined);
  registeredToken = null;
}
