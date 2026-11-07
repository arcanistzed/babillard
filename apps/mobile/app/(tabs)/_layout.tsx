import { Ionicons } from "@expo/vector-icons";
import type { InboxItem } from "@ideas-match/shared";
import { useQuery } from "@tanstack/react-query";
import { Tabs } from "expo-router";
import { api } from "@/api";
import { fonts, useTheme } from "@/theme";
import { t } from "@/i18n";

export default function TabsLayout() {
  const theme = useTheme();
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
        tabBarLabelStyle: { fontFamily: fonts.bodyBold, fontSize: 12 },
      }}
    >
      <Tabs.Screen name="deck" options={{ title: t("Topics", "Sujets"), tabBarIcon: ({ color, size }) => <Ionicons name="albums" color={String(color)} size={size} /> }} />
      <Tabs.Screen name="people" options={{ title: t("People", "Personnes"), tabBarIcon: ({ color, size }) => <Ionicons name="people" color={String(color)} size={size} /> }} />
      <Tabs.Screen
        name="inbox"
        options={{
          title: t("Chats", "Discussions"),
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.accent, color: theme.onAccent, fontFamily: fonts.bodyBold },
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" color={String(color)} size={size} />,
        }}
      />
      <Tabs.Screen name="profile" options={{ title: t("You", "Vous"), tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" color={String(color)} size={size} /> }} />
    </Tabs>
  );
}
