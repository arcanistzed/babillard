import { FIELD_LABELS, LOOKING_FOR_LABELS, ROLE_LABELS, type PeopleSwipeResult, type PersonCard } from "@ideas-match/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/api";
import { Celebration } from "@/components/Celebration";
import { DeckControls } from "@/components/DeckControls";
import { SwipeDeck, type SwipeDeckHandle, type SwipeDirection } from "@/components/SwipeDeck";
import { fonts, useTheme } from "@/theme";
import { Avatar, Button, Chip, ChipRow, ErrorText, T } from "@/ui";

function PersonFlyer({ person }: { person: PersonCard }) {
  const theme = useTheme();
  const subtitle = [ROLE_LABELS[person.role], person.campusName].filter(Boolean).join(", ");
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.ink }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Report or block ${person.displayName}`}
        hitSlop={8}
        style={styles.report}
        onPress={() => router.push({ pathname: "/report", params: { targetUserId: person.id, name: person.displayName } })}
      >
        <T variant="small" muted>
          Report or block
        </T>
      </Pressable>
      <View style={styles.identity}>
        <Avatar name={person.displayName} url={person.avatarUrl} size={92} />
        <View style={styles.identityText}>
          <Text style={[styles.name, { color: theme.ink }]}>{person.displayName}</Text>
          <T muted>{subtitle}</T>
          {person.verifiedInstitution ? (
            <T variant="small" style={{ color: theme.good, fontFamily: fonts.bodyBold }}>
              Verified school email
            </T>
          ) : null}
        </View>
      </View>

      {person.bio ? <T numberOfLines={4}>{person.bio}</T> : null}

      <View style={styles.section}>
        <T variant="heading">You both picked</T>
        {person.sharedTopics.slice(0, 3).map((topic) => (
          <T key={topic.id} variant="bodyBold">
            {topic.title}
          </T>
        ))}
        {person.sharedTopics.length > 3 ? <T muted>and {person.sharedTopics.length - 3} more</T> : null}
      </View>

      <View style={styles.section}>
        <T variant="heading">Looking for</T>
        <ChipRow>
          {person.lookingFor.map((item) => (
            <Chip key={item} label={LOOKING_FOR_LABELS[item]} />
          ))}
        </ChipRow>
      </View>

      <T variant="small" muted numberOfLines={2}>
        Into {person.fields.map((field) => FIELD_LABELS[field]).join(", ")}
      </T>
    </View>
  );
}

export default function People() {
  const queryClient = useQueryClient();
  const deck = useRef<SwipeDeckHandle>(null);
  const [cards, setCards] = useState<PersonCard[]>([]);
  const [match, setMatch] = useState<{ conversationId: string; name: string } | null>(null);
  const swiped = useRef(new Set<string>());
  const people = useQuery({ queryKey: ["people"], queryFn: () => api.get<PersonCard[]>("/people"), staleTime: 0 });

  useFocusEffect(
    useCallback(() => {
      void people.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  useEffect(() => {
    if (!people.data) return;
    const current = new Set(people.data.map((person) => person.id));
    setCards((existing) => {
      // People who blocked this user, or left, drop out here.
      const kept = existing.filter((card) => current.has(card.id));
      const known = new Set(kept.map((card) => card.id));
      return [...kept, ...people.data.filter((person) => !known.has(person.id) && !swiped.current.has(person.id))];
    });
  }, [people.data]);

  const onSwipe = useCallback(
    (person: PersonCard, direction: SwipeDirection) => {
      swiped.current.add(person.id);
      setCards((current) => current.filter((card) => card.id !== person.id));
      void api
        .post<PeopleSwipeResult>(`/people/${person.id}/swipe`, { direction })
        .then((result) => {
          if (result.matched && result.conversationId) {
            void queryClient.invalidateQueries({ queryKey: ["inbox"] });
            setMatch({ conversationId: result.conversationId, name: person.displayName });
          }
        })
        .catch(() => {
          swiped.current.delete(person.id);
        });
    },
    [queryClient],
  );

  const empty = cards.length === 0;

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.header}>
        <T variant="title">People who picked your topics</T>
      </View>

      <View style={styles.deck}>
        {empty ? (
          people.isPending ? (
            <ActivityIndicator accessibilityLabel="Loading people" size="large" style={styles.center} />
          ) : (
            <View style={styles.center}>
              {people.isError ? (
                <>
                  <ErrorText>Couldn't load people. Check your connection.</ErrorText>
                  <Button label="Try again" kind="secondary" onPress={() => people.refetch()} />
                </>
              ) : (
                <>
                  <T variant="title">Nobody new right now</T>
                  <T muted>People show up here once you've both picked the same topic. The more topics you pick, the more people you'll see.</T>
                  <Button label="Pick more topics" onPress={() => router.navigate("/deck")} />
                </>
              )}
            </View>
          )
        ) : (
          <SwipeDeck
            ref={deck}
            items={cards}
            keyOf={(person) => person.id}
            onSwipe={onSwipe}
            rightLabel="Let's talk"
            leftLabel="Pass"
            describeCard={(person) => `${person.displayName}. You both picked ${person.sharedTopics.map((topic) => topic.title).join(", ")}.`}
            renderCard={(person) => <PersonFlyer person={person} />}
          />
        )}
      </View>

      {!empty ? (
        <View style={styles.controls}>
          <DeckControls leftLabel="Pass" rightLabel="Let's talk" onLeft={() => deck.current?.swipe("left")} onRight={() => deck.current?.swipe("right")} />
        </View>
      ) : null}

      {match ? (
        <Celebration
          title="It's a match"
          body={`You and ${match.name} both want to talk. We've started the conversation for you. Say hi and pick a time to meet.`}
          action={`Say hi to ${match.name}`}
          dismissLabel="Keep swiping"
          onAction={() => {
            const id = match.conversationId;
            setMatch(null);
            router.push(`/chat/${id}`);
          }}
          onDismiss={() => setMatch(null)}
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
  card: { flex: 1, borderWidth: 2, borderRadius: 6, padding: 20, gap: 14, overflow: "hidden" },
  report: { alignSelf: "flex-end", minHeight: 24 },
  identity: { flexDirection: "row", alignItems: "center", gap: 14 },
  identityText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.display, fontSize: 32, lineHeight: 36 },
  section: { gap: 6 },
});
