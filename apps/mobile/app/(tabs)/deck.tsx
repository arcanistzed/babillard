import { Ionicons } from "@expo/vector-icons";
import { FIELD_GROUPS, GROUP_MIN_SIZE, type FieldGroupId, type Stance, type TopicCard, type TopicSwipeResult } from "@babillard/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/api";
import { Celebration } from "@/components/Celebration";
import { DeckControls } from "@/components/DeckControls";
import { Flyer } from "@/components/Flyer";
import { SwipeDeck, type SwipeDeckHandle, type SwipeDirection } from "@/components/SwipeDeck";
import { inviteToApp, inviteToTopic } from "@/invite";
import { fonts, useTheme } from "@/theme";
import { Button, Chip, ChipRow, ErrorText, T } from "@/ui";
import { shortGroupLabel, t } from "@/i18n";

const REFILL_AT = 5;
/** How long the card stays after a stance tap: long enough to see how the city leans, when there's a lean to show. */
const LEAN_PAUSE_MS = 1100;
const TAP_PAUSE_MS = 250;
const IN_LABEL = t("I'm in", "J'embarque");
const PASS_LABEL = t("Pass", "Passer");

export default function Deck() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const deck = useRef<SwipeDeckHandle>(null);
  const [cards, setCards] = useState<TopicCard[]>([]);
  const [stances, setStances] = useState<Record<string, Stance | null>>({});
  // The swipe reads stances from here, since a stance tap swipes before React re-renders with the new state.
  const stancesRef = useRef<Record<string, Stance | null>>({});
  const pendingSwipe = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topId = useRef<string | null>(null);
  const [openedGroup, setOpenedGroup] = useState<{ id: string; title: string } | null>(null);
  // The last topic this person joined that still needs people, which makes it the moment to bring a friend.
  const [nudge, setNudge] = useState<{ topic: TopicCard; needed: number } | null>(null);
  const [swipeFailed, setSwipeFailed] = useState(false);
  const swiped = useRef(new Set<string>());

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [group, setGroupFilter] = useState<FieldGroupId | null>(null);
  const topics = useQuery({ queryKey: ["topics", group], queryFn: () => api.get<TopicCard[]>(`/deck/topics${group ? `?group=${group}` : ""}`), staleTime: 0 });

  function chooseGroup(next: FieldGroupId | null) {
    setFiltersOpen(false);
    if (next === group) return;
    setCards([]);
    setGroupFilter(next);
  }

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

  useEffect(() => {
    topId.current = cards[0]?.id ?? null;
  }, [cards]);
  useEffect(() => () => clearTimeout(pendingSwipe.current ?? undefined), []);

  /** A stance means "I'm in", so tapping one sends the card right, after a moment to show the city's lean. */
  function chooseStance(topic: TopicCard, stance: Stance | null) {
    stancesRef.current[topic.id] = stance;
    setStances((current) => ({ ...current, [topic.id]: stance }));
    clearTimeout(pendingSwipe.current ?? undefined);
    pendingSwipe.current = null;
    if (!stance) return;
    pendingSwipe.current = setTimeout(
      () => {
        pendingSwipe.current = null;
        if (topId.current === topic.id) deck.current?.swipe("right");
      },
      topic.lean ? LEAN_PAUSE_MS : TAP_PAUSE_MS,
    );
  }

  const onSwipe = useCallback(
    (topic: TopicCard, direction: SwipeDirection) => {
      clearTimeout(pendingSwipe.current ?? undefined);
      pendingSwipe.current = null;
      swiped.current.add(topic.id);
      setNudge(null);
      setSwipeFailed(false);
      setCards((current) => {
        const next = current.filter((card) => card.id !== topic.id);
        if (next.length <= REFILL_AT) void queryClient.invalidateQueries({ queryKey: ["topics"] });
        return next;
      });
      const stance = direction === "right" && topic.kind === "question" ? (stancesRef.current[topic.id] ?? null) : null;
      void api
        .post<TopicSwipeResult>(`/deck/topics/${topic.id}/swipe`, { direction, stance })
        .then((result) => {
          void queryClient.invalidateQueries({ queryKey: ["people"] });
          if (result.groupConversationId) {
            void queryClient.invalidateQueries({ queryKey: ["inbox"] });
            setOpenedGroup({ id: result.groupConversationId, title: topic.title });
          } else if (direction === "right" && !topic.pending && topic.nearbyCount + 1 < GROUP_MIN_SIZE) {
            setNudge({ topic, needed: GROUP_MIN_SIZE - topic.nearbyCount - 1 });
          }
        })
        .catch(() => {
          // The topic goes back in the deck, right behind the card now on top.
          swiped.current.delete(topic.id);
          setCards((current) => (current.some((card) => card.id === topic.id) ? current : [...current.slice(0, 1), topic, ...current.slice(1)]));
          setSwipeFailed(true);
        });
    },
    [queryClient],
  );

  const empty = cards.length === 0;
  const filterLabel = group ? shortGroupLabel(group) : t("All topics", "Tous les sujets");

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.header}>
        {swipeFailed ? (
          <ErrorText>{t("That didn't save. Check your connection.", "Ce choix n'a pas été enregistré. Vérifiez votre connexion.")}</ErrorText>
        ) : nudge ? (
          <Animated.View key={nudge.topic.id} entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={styles.nudge}>
            <View style={styles.nudgeText}>
              <T variant="bodyBold">{t(`${nudge.needed} more for a group`, `Encore ${nudge.needed} pour un groupe`)}</T>
              <T variant="small" muted numberOfLines={1}>
                {nudge.topic.title}
              </T>
            </View>
            <Button
              label={t("Invite", "Inviter")}
              onPress={() => {
                inviteToTopic(nudge.topic);
                setNudge(null);
              }}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={t("Dismiss", "Fermer")} onPress={() => setNudge(null)} style={styles.close}>
              <Ionicons name="close" size={24} color={theme.ink} />
            </Pressable>
          </Animated.View>
        ) : (
          <View style={styles.titleRow}>
            <T variant="title" style={styles.title}>
              {t("Topics", "Sujets")}
            </T>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: filtersOpen }}
              accessibilityLabel={t(`Show topics from: ${filterLabel}`, `Afficher les sujets de: ${filterLabel}`)}
              onPress={() => setFiltersOpen(!filtersOpen)}
              style={[styles.filterButton, { borderColor: theme.control, backgroundColor: theme.surface }]}
            >
              <T variant="small" style={styles.filterLabel}>
                {filterLabel}
              </T>
              <Ionicons name={filtersOpen ? "chevron-up" : "chevron-down"} size={16} color={theme.ink} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            </Pressable>
          </View>
        )}
      </View>

      {/* Wraps rather than scrolls, so at large text sizes no filter hides off the edge. */}
      {filtersOpen ? (
        <ChipRow accessibilityRole="radiogroup" accessibilityLabel={t("Show topics from", "Afficher les sujets de")} style={styles.filters}>
          <Chip role="radio" label={t("All", "Tous")} selected={group === null} onPress={() => chooseGroup(null)} />
          {FIELD_GROUPS.map((entry) => (
            <Chip key={entry.id} role="radio" label={shortGroupLabel(entry.id)} selected={group === entry.id} onPress={() => chooseGroup(entry.id)} />
          ))}
        </ChipRow>
      ) : null}

      <View style={styles.deck}>
        {empty ? (
          topics.isPending || topics.isFetching ? (
            <ActivityIndicator accessibilityLabel={t("Loading topics", "Chargement des sujets")} size="large" style={styles.center} />
          ) : (
            <View style={styles.center}>
              {topics.isError ? (
                <>
                  <ErrorText>{t("Couldn't load topics. Check your connection.", "Impossible de charger les sujets. Vérifiez votre connexion.")}</ErrorText>
                  <Button label={t("Try again", "Réessayer")} kind="secondary" onPress={() => topics.refetch()} />
                </>
              ) : (
                <>
                  <T variant="title">{t("You've seen every topic", "Vous avez vu tous les sujets")}</T>
                  <Button label={t("Suggest a topic", "Suggérer un sujet")} onPress={() => router.push("/topic/new")} />
                  <Button label={t("Invite a friend", "Inviter quelqu'un")} kind="secondary" onPress={inviteToApp} />
                  <Button label={t("See people", "Voir les personnes")} kind="quiet" onPress={() => router.navigate("/people")} />
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
            rightLabel={IN_LABEL}
            leftLabel={PASS_LABEL}
            describeCard={(topic) => `${topic.title}. ${topic.blurb}${topic.nearbyCount > 0 ? t(` ${topic.nearbyCount} nearby.`, ` ${topic.nearbyCount} à proximité.`) : ""}`}
            renderCard={(topic, isTop, pull) => <Flyer isTop={isTop} pull={pull} topic={topic} stance={stances[topic.id] ?? null} onStance={(stance) => chooseStance(topic, stance)} />}
          />
        )}
      </View>

      {!empty ? (
        <View style={styles.controls}>
          <DeckControls leftLabel={PASS_LABEL} rightLabel={IN_LABEL} onLeft={() => deck.current?.swipe("left")} onRight={() => deck.current?.swipe("right")} />
        </View>
      ) : null}

      {openedGroup ? (
        <Celebration
          title={t("Your group is open", "Votre groupe est ouvert")}
          body={openedGroup.title}
          action={t("Open the group", "Ouvrir le groupe")}
          dismissLabel={t("Keep swiping", "Continuer")}
          onAction={() => {
            const id = openedGroup.id;
            setOpenedGroup(null);
            router.push(`/chat/${id}`);
          }}
          onDismiss={() => setOpenedGroup(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // Tall enough for the invite prompt, so swapping it in doesn't resize the card.
  header: { paddingHorizontal: 20, paddingVertical: 6, minHeight: 64, justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1 },
  filterButton: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 14, borderWidth: 1.5, borderRadius: 22 },
  filterLabel: { fontFamily: fonts.bodyBold },
  filters: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 10 },
  close: { width: 44, height: 44, marginHorizontal: -8, alignItems: "center", justifyContent: "center" },
  nudge: { flexDirection: "row", alignItems: "center", gap: 12 },
  nudgeText: { flex: 1 },
  deck: { flex: 1, marginHorizontal: 16 },
  center: { flex: 1, justifyContent: "center", gap: 12 },
  controls: { paddingHorizontal: 16, paddingVertical: 12 },
});
