import type { ExpoConfig } from "expo/config";

// The API domain hosts the Universal Link and App Link association files.
const apiHost = new URL(process.env.EXPO_PUBLIC_API_URL ?? "https://babillard.app").hostname;
const isRealHost = !["localhost", "10.0.2.2", "127.0.0.1"].includes(apiHost);

const config: ExpoConfig = {
  name: "Babillard",
  slug: "babillard",
  owner: "arcanistzed",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "babillard",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "com.babillard",
    supportsTablet: false,
    // Standard HTTPS only, so TestFlight doesn't ask about export compliance on every build.
    config: { usesNonExemptEncryption: false },
    ...(isRealHost ? { associatedDomains: [`applinks:${apiHost}`] } : {}),
  },
  android: {
    package: "com.babillard",
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
    ["expo-calendar", { calendarPermission: "Babillard adds meetups you confirm to your calendar.", remindersPermission: false }],
    ["expo-image-picker", { photosPermission: "Babillard uses a photo you choose for your profile.", cameraPermission: false, microphonePermission: false }],
    ["expo-location", { locationWhenInUsePermission: "Babillard uses your location once to suggest your city. It stays on your phone.", locationAlwaysAndWhenInUsePermission: false, locationAlwaysPermission: false }],
  ],
  extra: {
    eas: { projectId: "90b977e9-6bcd-4b3b-9059-d63e4b4d5bc1" },
  },
};

export default config;
