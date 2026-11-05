import { AtkinsonHyperlegible_400Regular } from "@expo-google-fonts/atkinson-hyperlegible/400Regular";
import { AtkinsonHyperlegible_700Bold } from "@expo-google-fonts/atkinson-hyperlegible/700Bold";
import { BricolageGrotesque_600SemiBold } from "@expo-google-fonts/bricolage-grotesque/600SemiBold";
import { BricolageGrotesque_800ExtraBold } from "@expo-google-fonts/bricolage-grotesque/800ExtraBold";
import type { PushData } from "@ideas-match/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider, useAuth } from "@/auth";
import { fonts, useTheme } from "@/theme";

void SplashScreen.preventAutoHideAsync();

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
    } else if (inSignedOutRoute || first === "onboard" || first === undefined) {
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
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[id]/index" options={{ title: "" }} />
      <Stack.Screen name="chat/[id]/info" options={{ title: "About this chat" }} />
      <Stack.Screen name="meetup/new" options={{ title: "Propose a meetup", presentation: "modal" }} />
      <Stack.Screen name="meetup/[id]" options={{ title: "Meetup" }} />
      <Stack.Screen name="member/[conversationId]/[userId]" options={{ title: "" }} />
      <Stack.Screen name="report" options={{ title: "Report", presentation: "modal" }} />
      <Stack.Screen name="topic/new" options={{ title: "Suggest a topic", presentation: "modal" }} />
      <Stack.Screen name="blocked" options={{ title: "Blocked people" }} />
      <Stack.Screen name="profile-edit" options={{ title: "Edit profile" }} />
    </Stack>
  );
}

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
