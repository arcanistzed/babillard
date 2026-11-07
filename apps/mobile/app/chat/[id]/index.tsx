import { Ionicons } from "@expo/vector-icons";
import type { ConversationDetail } from "@ideas-match/shared";
import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { api } from "@/api";
import { useAuth } from "@/auth";
import { MeetupCard } from "@/components/MeetupCard";
import { messageTime, timeLeft } from "@/format";
import { haptics } from "@/haptics";
import { fonts, useTheme } from "@/theme";
import { Chip, KeyboardScreen, T, useBottomPadding } from "@/ui";
import { useChat, type LocalMessage } from "@/useChat";

const SAME_RUN_MS = 5 * 60 * 1000;
const UNREADABLE = "Sent before you signed in on this phone";

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useAuth();
  const theme = useTheme();
  const bottomPadding = useBottomPadding();
  const [draft, setDraft] = useState("");

  const conversation = useQuery({ queryKey: ["conversation", id], queryFn: () => api.get<ConversationDetail>(`/conversations/${id}`) });
  const onRemoved = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/inbox");
  }, []);
  const { messages, loaded, send, loadOlder } = useChat(id, me?.id, onRemoved);

  // Only messages that arrive while the chat is open slide in. History just appears.
  const [openedAt] = useState(() => Date.now());
  const detail = conversation.data;
  const names = useMemo(() => new Map(detail?.members.map((member) => [member.id, member.displayName]) ?? []), [detail]);
  const hasOwnMessage = messages.some((message) => message.kind === "text");
  // A meetup posts a message when it's proposed, confirmed, or cancelled. The card always shows its current state, so one is enough.
  const reversed = useMemo(() => {
    const seenMeetups = new Set<string>();
    return [...messages].reverse().filter((message) => {
      if (message.kind !== "meetup" || !message.meetupId) return true;
      if (seenMeetups.has(message.meetupId)) return false;
      seenMeetups.add(message.meetupId);
      return true;
    });
  }, [messages]);

  function submit(text: string = draft) {
    const body = text.trim();
    if (!body || !me) return;
    send(body, me.id);
    haptics.tap();
    setDraft("");
  }

  function onLongPress(message: LocalMessage) {
    if (!message.senderId || message.senderId === me?.id) return;
    const name = names.get(message.senderId) ?? "this person";
    Alert.alert(`Message from ${name}`, undefined, [
      { text: "Report this message", onPress: () => router.push({ pathname: "/report", params: { targetUserId: message.senderId!, name, conversationId: id, messageId: message.id } }) },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function renderMessage({ item, index }: { item: LocalMessage; index: number }) {
    if (item.kind === "meetup" && item.meetupId) return <MeetupCard id={item.meetupId} />;
    if (item.kind === "system") {
      return (
        <View style={styles.system}>
          <T variant="small" muted style={styles.systemText}>
            {item.body}
          </T>
        </View>
      );
    }
    const mine = item.senderId === me?.id;
    const name = item.senderId ? (names.get(item.senderId) ?? "Former member") : "";
    // The list is newest first. A time goes under the last message of each run from one person.
    const next = reversed[index - 1];
    const endsRun = !next || next.senderId !== item.senderId || next.kind !== "text" || next.createdAt - item.createdAt > SAME_RUN_MS;
    return (
      // An inverted list flips its cells, so entering "from above" shows as rising from the composer.
      <Animated.View entering={item.createdAt >= openedAt ? FadeInUp.duration(180) : undefined}>
        <Pressable
          onLongPress={() => onLongPress(item)}
          onPress={item.failed && me ? () => send(item.body, me.id, item.clientId) : undefined}
          accessibilityLabel={`${mine ? "You" : name}: ${item.unreadable ? UNREADABLE : item.body}. ${item.failed ? "Not sent. Tap to retry." : messageTime(item.createdAt)}`}
          style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}
        >
          <View style={[styles.bubble, mine ? { backgroundColor: theme.ink } : { backgroundColor: theme.surface, borderColor: theme.line, borderWidth: 1 }, item.pending && !item.failed ? styles.pending : null]}>
            {!mine && detail?.kind === "group" ? (
              <T variant="small" style={{ fontFamily: fonts.bodyBold }}>
                {name}
              </T>
            ) : null}
            {item.unreadable ? (
            <T variant="small" style={[styles.unreadable, mine ? { color: theme.paper } : { color: theme.muted }]}>
              {UNREADABLE}
            </T>
          ) : (
            <T style={mine ? { color: theme.paper } : undefined}>{item.body}</T>
          )}
          </View>
          {item.failed ? (
            <T variant="small" style={{ color: theme.danger }}>
              Not sent. Tap to retry.
            </T>
          ) : endsRun && !item.pending ? (
            <T variant="small" muted style={styles.time}>
              {messageTime(item.createdAt)}
            </T>
          ) : null}
        </Pressable>
      </Animated.View>
    );
  }

  const openers = !hasOwnMessage ? (detail?.suggestedOpeners ?? []) : [];

  return (
    <KeyboardScreen>
      <Stack.Screen
        options={{
          title: detail?.title ?? "",
          headerRight: () => (
            <Pressable accessibilityRole="button" accessibilityLabel="About this chat" hitSlop={10} onPress={() => router.push(`/chat/${id}/info`)}>
              <Ionicons name="information-circle-outline" size={26} color={theme.ink} />
            </Pressable>
          ),
        }}
      />

      {detail?.expiresAt && !hasOwnMessage ? (
        <View style={[styles.banner, { backgroundColor: theme.accent }]}>
          <T variant="small" style={{ color: theme.onAccent, fontFamily: fonts.bodyBold }}>
            {timeLeft(detail.expiresAt)} left to say hi
          </T>
        </View>
      ) : null}

      {!loaded ? (
        <ActivityIndicator accessibilityLabel="Loading messages" size="large" style={styles.loading} />
      ) : (
        <FlatList
          inverted
          data={reversed}
          keyExtractor={(item) => item.clientId ?? item.id}
          renderItem={renderMessage}
          onEndReached={() => void loadOlder().catch(() => undefined)}
          onEndReachedThreshold={0.3}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        />
      )}

      <View style={[styles.composerArea, { borderTopColor: theme.line, backgroundColor: theme.paper, paddingBottom: bottomPadding }]}>
        {openers.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.openers} keyboardShouldPersistTaps="handled">
            {openers.map((opener) => (
              <Chip key={opener} label={opener} onPress={() => submit(opener)} />
            ))}
          </ScrollView>
        ) : null}
        <View style={styles.composer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Propose a meetup"
            onPress={() => router.push({ pathname: "/meetup/new", params: { conversationId: id } })}
            style={[styles.meetButton, { backgroundColor: theme.accent }]}
          >
            <Ionicons name="calendar" size={18} color={theme.onAccent} />
            <T variant="small" style={{ color: theme.onAccent, fontFamily: fonts.bodyBold }}>
              Meet up
            </T>
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a message"
            placeholderTextColor={theme.muted}
            accessibilityLabel="Write a message"
            multiline
            maxLength={4000}
            style={[styles.input, { color: theme.ink, backgroundColor: theme.surface, borderColor: theme.line, fontFamily: fonts.body }]}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!draft.trim()} onPress={() => submit()} hitSlop={6} style={[styles.send, { opacity: draft.trim() ? 1 : 0.35 }]}>
            <Ionicons name="send" size={24} color={theme.ink} />
          </Pressable>
        </View>
      </View>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1 },
  banner: { paddingHorizontal: 16, paddingVertical: 8 },
  list: { paddingVertical: 12, flexGrow: 1 },
  system: { paddingHorizontal: 28, paddingVertical: 8 },
  systemText: { textAlign: "center" },
  bubbleRow: { paddingHorizontal: 12, paddingVertical: 3, alignItems: "flex-start" },
  bubbleRowMine: { alignItems: "flex-end" },
  bubble: { maxWidth: "82%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  pending: { opacity: 0.6 },
  unreadable: { fontStyle: "italic" },
  time: { fontSize: 12, lineHeight: 16, marginTop: 2, marginHorizontal: 4 },
  composerArea: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  openers: { gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 10 },
  meetButton: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 44, paddingHorizontal: 11, borderRadius: 12 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, fontSize: 16 },
  send: { minHeight: 44, minWidth: 40, alignItems: "center", justifyContent: "center" },
});
