import type { ExpoConfig } from "expo/config";

// The API domain hosts the Universal Link and App Link association files.
const apiHost = new URL(process.env.EXPO_PUBLIC_API_URL ?? "https://ideas-match-api.ideas-match.workers.dev").hostname;
const isRealHost = !["localhost", "10.0.2.2", "127.0.0.1"].includes(apiHost);

const config: ExpoConfig = {
  name: "Ideas Match",
  slug: "ideas-match",
  owner: "arcanistzed",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "ideasmatch",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "app.ideasmatch",
    supportsTablet: false,
    // Standard HTTPS only, so TestFlight doesn't ask about export compliance on every build.
    config: { usesNonExemptEncryption: false },
    ...(isRealHost ? { associatedDomains: [`applinks:${apiHost}`] } : {}),
  },
  android: {
    package: "app.ideasmatch",
    softwareKeyboardLayoutMode: "resize",
    googleServicesFile: "./google-services.json",
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#FF5FAE" },
    ...(isRealHost
      ? {
          intentFilters: [
            {
              action: "VIEW",
              autoVerify: true,
              data: [{ scheme: "https", host: apiHost, pathPrefix: "/auth/link" }],
              category: ["BROWSABLE", "DEFAULT"],
            },
          ],
        }
      : {}),
  },
  plugins: [
    "expo-router",
    ["expo-splash-screen", { image: "./assets/splash.png", imageWidth: 200, backgroundColor: "#FF5FAE" }],
    ["expo-secure-store", { faceIDPermission: false }],
    "expo-font",
    "expo-notifications",
    ["expo-calendar", { calendarPermission: "Ideas Match adds meetups you confirm to your calendar.", remindersPermission: false }],
    ["expo-image-picker", { photosPermission: "Ideas Match uses a photo you choose for your profile.", cameraPermission: false, microphonePermission: false }],
    ["expo-location", { locationWhenInUsePermission: "Ideas Match uses your location once to suggest your city. It stays on your phone.", locationAlwaysAndWhenInUsePermission: false, locationAlwaysPermission: false }],
  ],
  extra: {
    eas: { projectId: "54672913-5065-4a88-8789-a29ffcb13a89" },
  },
};

export default config;
