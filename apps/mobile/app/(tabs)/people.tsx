import { type PeopleSwipeResult, type PersonCard } from "@ideas-match/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/api";
import { Celebration } from "@/components/Celebration";
import { DeckControls } from "@/components/DeckControls";
import { SwipeDeck, type SwipeDeckHandle, type SwipeDirection } from "@/components/SwipeDeck";
import { inviteToApp } from "@/invite";
import { fonts, useTheme } from "@/theme";
import { Avatar, Button, Chip, ChipRow, ErrorText, T } from "@/ui";
import { fieldLabel, lookingForLabel, roleLabel, t } from "@/i18n";

function PersonFlyer({ person }: { person: PersonCard }) {
  const theme = useTheme();
  const subtitle = [roleLabel(person.role), person.campusName].filter(Boolean).join(", ");
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.ink }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(`Report or block ${person.displayName}`, `Signaler ou bloquer ${person.displayName}`)}
        hitSlop={8}
        style={styles.report}
        onPress={() => router.push({ pathname: "/report", params: { targetUserId: person.id, name: person.displayName } })}
      >
        <T variant="small" muted>
          {t("Report or block", "Signaler ou bloquer")}
        </T>
      </Pressable>
      <View style={styles.identity}>
        <Avatar name={person.displayName} url={person.avatarUrl} size={92} />
        <View style={styles.identityText}>
          <Text style={[styles.name, { color: theme.ink }]}>{person.displayName}</Text>
          <T muted>{subtitle}</T>
          {person.verifiedInstitution ? (
            <T variant="small" style={{ color: theme.good, fontFamily: fonts.bodyBold }}>
              {t("Verified school email", "Courriel scolaire vérifié")}
            </T>
          ) : null}
        </View>
      </View>

      {person.bio ? <T numberOfLines={4}>{person.bio}</T> : null}

      <View style={styles.section}>
        <T variant="heading">{t("You both picked", "Vous avez tous deux choisi")}</T>
        {person.sharedTopics.slice(0, 3).map((topic) => (
          <T key={topic.id} variant="bodyBold">
            {topic.title}
          </T>
        ))}
        {person.sharedTopics.length > 3 ? <T muted>{t(`and ${person.sharedTopics.length - 3} more`, `et ${person.sharedTopics.length - 3} de plus`)}</T> : null}
      </View>

      <View style={styles.section}>
        <T variant="heading">{t("Looking for", "Recherche")}</T>
        <ChipRow>
          {person.lookingFor.map((item) => (
            <Chip key={item} label={lookingForLabel(item)} />
          ))}
        </ChipRow>
      </View>

      <T variant="small" muted numberOfLines={2}>
        {t("Into", "Intérêts :")} {person.fields.map((field) => fieldLabel(field)).join(", ")}
      </T>
    </View>
  );
}

const TALK_LABEL = t("Let's talk", "Parlons-en");
const PASS_LABEL = t("Pass", "Passer");

export default function People() {
  const queryClient = useQueryClient();
  const deck = useRef<SwipeDeckHandle>(null);
  const [cards, setCards] = useState<PersonCard[]>([]);
  const [match, setMatch] = useState<{ conversationId: string; name: string } | null>(null);
  const [swipeFailed, setSwipeFailed] = useState(false);
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
      setSwipeFailed(false);
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
          // They go back in the deck, right behind the card now on top.
          swiped.current.delete(person.id);
          setCards((current) => (current.some((card) => card.id === person.id) ? current : [...current.slice(0, 1), person, ...current.slice(1)]));
          setSwipeFailed(true);
        });
    },
    [queryClient],
  );

  const empty = cards.length === 0;

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.header}>
        {swipeFailed ? <ErrorText>{t("That didn't save, so they'll come back. Check your connection.", "Ce choix n'a pas été enregistré. Cette personne reviendra. Vérifiez votre connexion.")}</ErrorText> : <T variant="title" numberOfLines={2}>{t("People who picked your topics", "Ils ont choisi vos sujets")}</T>}
      </View>

      <View style={styles.deck}>
        {empty ? (
          people.isPending ? (
            <ActivityIndicator accessibilityLabel={t("Loading people", "Chargement des personnes")} size="large" style={styles.center} />
          ) : (
            <View style={styles.center}>
              {people.isError ? (
                <>
                  <ErrorText>{t("Couldn't load people. Check your connection.", "Impossible de charger les personnes. Vérifiez votre connexion.")}</ErrorText>
                  <Button label={t("Try again", "Réessayer")} kind="secondary" onPress={() => people.refetch()} />
                </>
              ) : (
                <>
                  <T variant="title">{t("Nobody new right now", "Personne de nouveau pour l'instant")}</T>
                  <Button label={t("Invite a friend", "Inviter quelqu'un")} onPress={inviteToApp} />
                  <Button label={t("Pick more topics", "Choisir d'autres sujets")} kind="secondary" onPress={() => router.navigate("/deck")} />
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
            rightLabel={TALK_LABEL}
            leftLabel={PASS_LABEL}
            describeCard={(person) => `${person.displayName}. ${t("You both picked", "Vous avez tous deux choisi")} ${person.sharedTopics.map((topic) => topic.title).join(", ")}.`}
            renderCard={(person) => <PersonFlyer person={person} />}
          />
        )}
      </View>

      {!empty ? (
        <View style={styles.controls}>
          <DeckControls leftLabel={PASS_LABEL} rightLabel={TALK_LABEL} onLeft={() => deck.current?.swipe("left")} onRight={() => deck.current?.swipe("right")} />
        </View>
      ) : null}

      {match ? (
        <Celebration
          title={t("It's a match", "C'est un jumelage")}
          body={t(`You and ${match.name} both want to talk.`, `${match.name} et vous voulez en parler.`)}
          action={t(`Say hi to ${match.name}`, `Écrire à ${match.name}`)}
          dismissLabel={t("Keep swiping", "Continuer")}
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
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, minHeight: 84, justifyContent: "center" },
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
