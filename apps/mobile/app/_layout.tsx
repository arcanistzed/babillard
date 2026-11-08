import { AtkinsonHyperlegible_400Regular } from "@expo-google-fonts/atkinson-hyperlegible/400Regular";
import { AtkinsonHyperlegible_700Bold } from "@expo-google-fonts/atkinson-hyperlegible/700Bold";
import { BricolageGrotesque_600SemiBold } from "@expo-google-fonts/bricolage-grotesque/600SemiBold";
import { BricolageGrotesque_800ExtraBold } from "@expo-google-fonts/bricolage-grotesque/800ExtraBold";
import type { PushData } from "@babillard/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { Stack, router, useSegments, type ErrorBoundaryProps } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, useColorScheme, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider, useAuth } from "@/auth";
import { installCrashReporter, reportCrash } from "@/crashReporter";
import { fonts, useTheme } from "@/theme";
import { Button, T } from "@/ui";
import { t } from "@/i18n";

void SplashScreen.preventAutoHideAsync();
installCrashReporter();

/** expo-router shows this in place of any screen that throws while rendering. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const theme = useTheme();
  useEffect(() => {
    reportCrash(error, true);
    void SplashScreen.hideAsync();
  }, [error]);
  return (
    <View style={[styles.crash, { backgroundColor: theme.paper }]}>
      <StatusBar style="auto" />
      <T variant="title">{t("Something went wrong", "Un problème est survenu")}</T>
      <Button label={t("Try again", "Réessayer")} onPress={() => void retry()} />
    </View>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

const SIGNED_OUT_ROUTES = new Set(["sign-in", "check-inbox", "auth"]);

/** Sends people to the one place they belong: sign-in, onboarding, or the app. */
function useRouteGuard() {
  const { ready, me } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (!ready) return;
    const first = segments[0] as string | undefined;
    const inSignedOutRoute = first !== undefined && SIGNED_OUT_ROUTES.has(first);
    if (!me) {
      if (!inSignedOutRoute) router.replace("/sign-in");
    } else if (!me.onboarded) {
      if (first !== "onboard") router.replace("/onboard");
    } else if (!me.termsAccepted) {
      if (first !== "agree") router.replace("/agree");
    } else if (inSignedOutRoute || first === "onboard" || first === "agree" || first === undefined) {
      router.replace("/deck");
    }
  }, [ready, me, segments]);
}

function usePushRouting() {
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      const data = response?.notification.request.content.data as Partial<PushData> | undefined;
      if (!data?.id) return;
      router.push(data.screen === "meetup" ? `/meetup/${data.id}` : `/chat/${data.id}`);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, []);
}

function Navigator() {
  const theme = useTheme();
  const { ready } = useAuth();
  useRouteGuard();
  usePushRouting();

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.paper },
        headerShadowVisible: false,
        headerTintColor: theme.ink,
        headerTitleStyle: { fontFamily: fonts.displayMedium, fontSize: 18 },
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: theme.paper },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="check-inbox" options={{ title: "" }} />
      <Stack.Screen name="auth/link" options={{ headerShown: false }} />
      <Stack.Screen name="onboard" options={{ headerShown: false }} />
      <Stack.Screen name="agree" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[id]/index" options={{ title: "" }} />
      <Stack.Screen name="chat/[id]/info" options={{ title: t("About this chat", "À propos") }} />
      <Stack.Screen name="meetup/new" options={{ title: t("Propose a meetup", "Proposer une rencontre"), presentation: "modal" }} />
      <Stack.Screen name="meetup/[id]" options={{ title: t("Meetup", "Rencontre") }} />
      <Stack.Screen name="member/[conversationId]/[userId]" options={{ title: "" }} />
      <Stack.Screen name="report" options={{ title: t("Report", "Signaler"), presentation: "modal" }} />
      <Stack.Screen name="topic/new" options={{ title: t("Suggest a topic", "Suggérer un sujet"), presentation: "modal" }} />
      <Stack.Screen name="key-backup" options={{ title: t("Back up messages", "Sauvegarder les messages") }} />
      <Stack.Screen name="blocked" options={{ title: t("Blocked people", "Personnes bloquées") }} />
      <Stack.Screen name="profile-edit" options={{ title: t("Edit profile", "Modifier le profil") }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  crash: { flex: 1, padding: 24, gap: 16, justifyContent: "center" },
});

export default function RootLayout() {
  const scheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_800ExtraBold,
    BricolageGrotesque_600SemiBold,
    AtkinsonHyperlegible_400Regular,
    AtkinsonHyperlegible_700Bold,
  });
  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <Navigator />
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
