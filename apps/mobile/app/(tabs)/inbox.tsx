import { openMessage, type InboxItem } from "@ideas-match/shared";
import { useQuery } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/api";
import { useAuth } from "@/auth";
import { ensureDeviceKey } from "@/e2ee";
import { describeWhen, timeLeft } from "@/format";
import { inviteToApp } from "@/invite";
import { flyerInk, fonts, useTheme } from "@/theme";
import { Avatar, Button, ErrorText, T } from "@/ui";
import { t } from "@/i18n";

/** The server only has ciphertext for the latest message, so the phone works out the preview itself. */
function usePreviews(items: InboxItem[] | undefined): Record<string, string> {
  const { me } = useAuth();
  const [previews, setPreviews] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!me || !items) return;
    let active = true;
    void ensureDeviceKey(me.id)
      .then((key) => {
        const next: Record<string, string> = {};
        for (const item of items) {
          if (!item.lastMessageEnvelope || !item.lastMessageSenderId) continue;
          const opened = openMessage({ envelope: item.lastMessageEnvelope, conversationId: item.id, senderId: item.lastMessageSenderId, me: key });
          next[item.id] = opened?.text ?? t("New message", "Nouveau message");
        }
        if (active) setPreviews(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [items, me]);
  return previews;
}

function Row({ item, preview }: { item: InboxItem; preview: string | null }) {
  const theme = useTheme();
  const expiring = item.expiresAt !== null;
  const unread = item.unreadCount > 0;
  const groupTint = flyerInk(undefined);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${preview ?? ""}${unread ? t(`. ${item.unreadCount} unread`, `. ${item.unreadCount} non lus`) : ""}`}
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
            {item.topicTitle}
          </T>
        ) : null}
        {item.kind === "group" ? (
          <T variant="small" muted>
            {t(`${item.memberCount} people`, `${item.memberCount} personnes`)}
          </T>
        ) : null}
        {preview ? (
          <T numberOfLines={1} variant={unread ? "bodyBold" : "body"} muted={!unread}>
            {preview}
          </T>
        ) : null}
        {item.nextMeetupAt ? (
          <T variant="small" style={{ color: theme.good, fontFamily: fonts.bodyBold }}>
            {t("Meeting", "Rencontre")} {describeWhen(item.nextMeetupAt)}
          </T>
        ) : null}
        {expiring ? (
          <T variant="small" style={{ color: theme.accent, fontFamily: fonts.bodyBold }}>
            {t(`${timeLeft(item.expiresAt!)} left to say hi`, `Il reste ${timeLeft(item.expiresAt!)} pour dire bonjour`)}
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
  const previews = usePreviews(inbox.data);

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
        renderItem={({ item }) => <Row item={item} preview={item.lastMessagePreview ?? previews[item.id] ?? null} />}
        refreshControl={<RefreshControl refreshing={inbox.isRefetching} onRefresh={() => void inbox.refetch()} />}
        ListHeaderComponent={<T variant="title" style={styles.title}>{t("Chats", "Conversations")}</T>}
        ListEmptyComponent={
          inbox.isPending ? undefined : inbox.isError ? (
            <View style={styles.empty}>
              <ErrorText>{t("Couldn't load your chats. Check your connection.", "Impossible de charger vos conversations. Vérifiez votre connexion.")}</ErrorText>
              <Button label={t("Try again", "Réessayer")} kind="secondary" onPress={() => inbox.refetch()} />
            </View>
          ) : (
            <View style={styles.empty}>
              <T variant="heading">{t("No chats yet", "Aucune conversation pour l'instant")}</T>
              <Button label={t("Pick topics", "Choisir des sujets")} onPress={() => router.navigate("/deck")} />
              <Button label={t("Invite a friend", "Inviter quelqu'un")} kind="secondary" onPress={inviteToApp} />
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
