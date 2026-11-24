import type { ExpoConfig } from "expo/config";
import { versionCode } from "../../packages/shared/src/version.ts";

// The one number to change for a release. Android's build code comes from it (0.2.0 is 200).
const version = "0.3.6";

// The API domain hosts the Universal Link and App Link association files.
const apiHost = new URL(process.env.EXPO_PUBLIC_API_URL ?? "https://babillard.app").hostname;
const isRealHost = !["localhost", "10.0.2.2", "127.0.0.1"].includes(apiHost);

/** An Android App Link on the API domain, checked against its assetlinks.json. */
function appLink(path: { path: string } | { pathPrefix: string }) {
  return { action: "VIEW", autoVerify: true, data: [{ scheme: "https", host: apiHost, ...path }], category: ["BROWSABLE", "DEFAULT"] };
}

const projectId = "90b977e9-6bcd-4b3b-9059-d63e4b4d5bc1";

const config: ExpoConfig = {
  name: "Babillard",
  slug: "babillard",
  owner: "arcanistzed",
  version,
  orientation: "portrait",
  scheme: "babillard",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  // An over-the-air update only reaches installs whose native code has the same fingerprint, so an update
  // that needs new native code is never applied to an APK that can't run it.
  runtimeVersion: { policy: "fingerprint" },
  updates: { url: `https://u.expo.dev/${projectId}`, checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 },
  ios: {
    bundleIdentifier: "com.babillard",
    buildNumber: String(versionCode(version)),
    supportsTablet: false,
    // Standard HTTPS only, so TestFlight doesn't ask about export compliance on every build.
    config: { usesNonExemptEncryption: false },
    ...(isRealHost ? { associatedDomains: [`applinks:${apiHost}`] } : {}),
  },
  android: {
    package: "com.babillard",
    versionCode: versionCode(version),
    softwareKeyboardLayoutMode: "resize",
    googleServicesFile: "./google-services.json",
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", monochromeImage: "./assets/monochrome-icon.png", backgroundColor: "#FF5FAE" },
    // Sign-in links, topic links and invites open the app when it's installed, and the web page when it isn't.
    ...(isRealHost
      ? {
          intentFilters: [appLink({ pathPrefix: "/auth/link" }), appLink({ pathPrefix: "/t/" }), appLink({ path: "/invite" })],
        }
      : {}),
  },
  plugins: [
    "expo-router",
    ["expo-splash-screen", { image: "./assets/splash.png", imageWidth: 200, backgroundColor: "#FF5FAE" }],
    ["expo-secure-store", { faceIDPermission: false }],
    "expo-font",
    // Android draws the status-bar icon as a white silhouette, so it needs its own transparent image.
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#FF5FAE" }],
    ["expo-calendar", { calendarPermission: "Babillard adds meetups you confirm to your calendar.", remindersPermission: false }],
    ["expo-image-picker", { photosPermission: "Babillard uses a photo you choose for your profile.", cameraPermission: false, microphonePermission: false }],
    ["expo-location", { locationWhenInUsePermission: "Babillard uses your location once to suggest your city. It stays on your phone.", locationAlwaysAndWhenInUsePermission: false, locationAlwaysPermission: false }],
  ],
  extra: {
    eas: { projectId },
  },
};

export default config;
