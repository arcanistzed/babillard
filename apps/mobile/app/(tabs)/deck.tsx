import type { Stance, TopicCard, TopicSwipeResult } from "@ideas-match/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/api";
import { Celebration } from "@/components/Celebration";
import { DeckControls } from "@/components/DeckControls";
import { Flyer } from "@/components/Flyer";
import { SwipeDeck, type SwipeDeckHandle, type SwipeDirection } from "@/components/SwipeDeck";
import { Button, ErrorText, T } from "@/ui";

const REFILL_AT = 5;

export default function Deck() {
  const queryClient = useQueryClient();
  const deck = useRef<SwipeDeckHandle>(null);
  const [cards, setCards] = useState<TopicCard[]>([]);
  const [stances, setStances] = useState<Record<string, Stance | null>>({});
  const [group, setGroup] = useState<{ id: string; title: string } | null>(null);
  const swiped = useRef(new Set<string>());

  const topics = useQuery({ queryKey: ["topics"], queryFn: () => api.get<TopicCard[]>("/deck/topics"), staleTime: 0 });

  useEffect(() => {
    if (!topics.data) return;
    setCards((current) => {
      const known = new Set(current.map((card) => card.id));
      const fresh = topics.data.filter((card) => !known.has(card.id) && !swiped.current.has(card.id));
      // A topic this person just suggested goes right after the card they're looking at.
      const [top, ...rest] = current;
      const suggested = fresh.filter((card) => card.pending);
      const others = fresh.filter((card) => !card.pending);
      return top ? [top, ...suggested, ...rest, ...others] : [...suggested, ...others];
    });
  }, [topics.data]);

  const onSwipe = useCallback(
    (topic: TopicCard, direction: SwipeDirection) => {
      swiped.current.add(topic.id);
      setCards((current) => {
        const next = current.filter((card) => card.id !== topic.id);
        if (next.length <= REFILL_AT) void queryClient.invalidateQueries({ queryKey: ["topics"] });
        return next;
      });
      const stance = direction === "right" && topic.kind === "question" ? (stances[topic.id] ?? null) : null;
      void api
        .post<TopicSwipeResult>(`/deck/topics/${topic.id}/swipe`, { direction, stance })
        .then((result) => {
          void queryClient.invalidateQueries({ queryKey: ["people"] });
          if (result.groupConversationId) {
            void queryClient.invalidateQueries({ queryKey: ["inbox"] });
            setGroup({ id: result.groupConversationId, title: topic.title });
          }
        })
        .catch(() => {
          // Let the topic come back on the next refill instead of losing the choice.
          swiped.current.delete(topic.id);
        });
    },
    [queryClient, stances],
  );

  const empty = cards.length === 0;

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.header}>
        <T variant="title">What do you want to talk about?</T>
      </View>

      <View style={styles.deck}>
        {empty ? (
          topics.isPending || topics.isFetching ? (
            <ActivityIndicator accessibilityLabel="Loading topics" size="large" style={styles.center} />
          ) : (
            <View style={styles.center}>
              {topics.isError ? (
                <>
                  <ErrorText>Couldn't load topics. Check your connection.</ErrorText>
                  <Button label="Try again" kind="secondary" onPress={() => topics.refetch()} />
                </>
              ) : (
                <>
                  <T variant="title">You've seen every topic</T>
                  <Button label="Suggest a topic" onPress={() => router.push("/topic/new")} />
                  <Button label="See people" kind="secondary" onPress={() => router.navigate("/people")} />
                </>
              )}
            </View>
          )
        ) : (
          <SwipeDeck
            ref={deck}
            items={cards}
            keyOf={(topic) => topic.id}
            onSwipe={onSwipe}
            rightLabel="I'm in"
            leftLabel="Pass"
            describeCard={(topic) => `${topic.title}. ${topic.blurb} ${topic.nearbyCount} nearby.`}
            renderCard={(topic, isTop) => <Flyer isTop={isTop} topic={topic} stance={stances[topic.id] ?? null} onStance={(stance) => setStances((current) => ({ ...current, [topic.id]: stance }))} />}
          />
        )}
      </View>

      {!empty ? (
        <View style={styles.controls}>
          <DeckControls leftLabel="Pass" rightLabel="I'm in" onLeft={() => deck.current?.swipe("left")} onRight={() => deck.current?.swipe("right")} />
        </View>
      ) : null}

      {group ? (
        <Celebration
          title="Your group is open"
          body={group.title}
          action="Open the group"
          dismissLabel="Keep swiping"
          onAction={() => {
            const id = group.id;
            setGroup(null);
            router.push(`/chat/${id}`);
          }}
          onDismiss={() => setGroup(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 },
  deck: { flex: 1, marginHorizontal: 16 },
  center: { flex: 1, justifyContent: "center", gap: 12 },
  controls: { paddingHorizontal: 16, paddingVertical: 12 },
});
