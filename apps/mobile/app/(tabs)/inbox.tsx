import type { InboxItem } from "@ideas-match/shared";
import { useQuery } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/api";
import { describeWhen, timeLeft } from "@/format";
import { flyerInk, fonts, useTheme } from "@/theme";
import { Avatar, Button, ErrorText, T } from "@/ui";

function Row({ item }: { item: InboxItem }) {
  const theme = useTheme();
  const expiring = item.expiresAt !== null;
  const unread = item.unreadCount > 0;
  const groupTint = flyerInk(undefined);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.lastMessagePreview ?? ""}${unread ? `. ${item.unreadCount} unread` : ""}`}
      onPress={() => router.push(`/chat/${item.id}`)}
      style={({ pressed }) => [styles.row, { borderBottomColor: theme.line, opacity: pressed ? 0.7 : 1 }]}
    >
      <Avatar name={item.title} url={item.avatarUrl} size={52} tint={item.kind === "group" ? groupTint : undefined} />
      <View style={styles.rowBody}>
        <T variant="heading" numberOfLines={1}>
          {item.title}
        </T>
        {item.kind === "direct" && item.topicTitle ? (
          <T variant="small" muted numberOfLines={1}>
            On {item.topicTitle}
          </T>
        ) : null}
        {item.kind === "group" ? (
          <T variant="small" muted>
            {item.memberCount} people
          </T>
        ) : null}
        {item.lastMessagePreview ? (
          <T numberOfLines={1} variant={unread ? "bodyBold" : "body"} muted={!unread}>
            {item.lastMessagePreview}
          </T>
        ) : null}
        {item.nextMeetupAt ? (
          <T variant="small" style={{ color: theme.good, fontFamily: fonts.bodyBold }}>
            Meeting {describeWhen(item.nextMeetupAt)}
          </T>
        ) : null}
        {expiring ? (
          <T variant="small" style={{ color: theme.accent, fontFamily: fonts.bodyBold }}>
            {timeLeft(item.expiresAt!)} left to say hi
          </T>
        ) : null}
      </View>
      {unread ? (
        <View style={[styles.badge, { backgroundColor: theme.accent }]}>
          <T variant="small" style={{ color: theme.onAccent, fontFamily: fonts.bodyBold }}>
            {item.unreadCount}
          </T>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function Inbox() {
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => api.get<InboxItem[]>("/conversations") });

  useFocusEffect(
    useCallback(() => {
      void inbox.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <FlatList
        data={inbox.data ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <Row item={item} />}
        refreshControl={<RefreshControl refreshing={inbox.isRefetching} onRefresh={() => void inbox.refetch()} />}
        ListHeaderComponent={<T variant="title" style={styles.title}>Chats</T>}
        ListEmptyComponent={
          inbox.isPending ? undefined : inbox.isError ? (
            <View style={styles.empty}>
              <ErrorText>Couldn't load your chats. Check your connection.</ErrorText>
              <Button label="Try again" kind="secondary" onPress={() => inbox.refetch()} />
            </View>
          ) : (
            <View style={styles.empty}>
              <T variant="heading">No chats yet</T>
              <Button label="Pick topics" onPress={() => router.navigate("/deck")} />
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 },
  row: { flexDirection: "row", gap: 14, alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  rowBody: { flex: 1, gap: 1 },
  badge: { minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 7, alignItems: "center", justifyContent: "center" },
  empty: { padding: 20, gap: 12 },
});
