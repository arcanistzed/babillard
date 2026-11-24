import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import type { InboxItem } from "@babillard/shared";
import { useQuery } from "@tanstack/react-query";
import { Tabs } from "expo-router";
import { useWindowDimensions } from "react-native";
import { api } from "@/api";
import { fonts, useTheme } from "@/theme";
import { t } from "@/i18n";

/** The icon font draws each icon as a private-use character, which a screen reader would read out, so icons stay hidden and each tab has its own label. */
function TabIcon({ name, color, size }: { name: ComponentProps<typeof Ionicons>["name"]; color: string; size: number }) {
  return <Ionicons name={name} color={color} size={size} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

export default function TabsLayout() {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => api.get<InboxItem[]>("/conversations"), refetchInterval: 30_000 });
  const unread = inbox.data?.reduce((total, item) => total + item.unreadCount, 0) ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.paper },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: { backgroundColor: theme.paper, borderTopColor: theme.line },
        // Grows with the text size only as far as "Discussions" still fits in a quarter of the screen.
        tabBarAllowFontScaling: false,
        tabBarLabelStyle: { fontFamily: fonts.bodyBold, fontSize: 12 * Math.min(fontScale, 1.15) },
      }}
    >
      <Tabs.Screen name="deck" options={{ title: t("Topics", "Sujets"), tabBarAccessibilityLabel: t("Topics", "Sujets"), tabBarIcon: ({ color, size }) => <TabIcon name="albums" color={String(color)} size={size} /> }} />
      <Tabs.Screen name="people" options={{ title: t("People", "Personnes"), tabBarAccessibilityLabel: t("People", "Personnes"), tabBarIcon: ({ color, size }) => <TabIcon name="people" color={String(color)} size={size} /> }} />
      <Tabs.Screen
        name="inbox"
        options={{
          title: t("Chats", "Discussions"),
          // The label replaces everything inside the tab, so it carries the unread count the badge shows.
          tabBarAccessibilityLabel: unread > 0 ? t(`Chats, ${unread} unread`, `Discussions, ${unread} ${unread === 1 ? "message non lu" : "messages non lus"}`) : t("Chats", "Discussions"),
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.accent, color: theme.onAccent, fontFamily: fonts.bodyBold },
          tabBarIcon: ({ color, size }) => <TabIcon name="chatbubbles" color={String(color)} size={size} />,
        }}
      />
      <Tabs.Screen name="profile" options={{ title: t("You", "Vous"), tabBarAccessibilityLabel: t("You", "Vous"), tabBarIcon: ({ color, size }) => <TabIcon name="person-circle" color={String(color)} size={size} /> }} />
    </Tabs>
  );
}
