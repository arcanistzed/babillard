import type { Stance, TopicLink, TopicSwipeResult } from "@babillard/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError, friendlyError } from "@/api";
import { useAuth } from "@/auth";
import { DeckControls } from "@/components/DeckControls";
import { Flyer } from "@/components/Flyer";
import { inviteToTopic } from "@/invite";
import { Button, ErrorText, T } from "@/ui";
import { t } from "@/i18n";

const IN_LABEL = t("I'm in", "J'embarque");
const PASS_LABEL = t("Pass", "Passer");

const notFound = (error: unknown) => error instanceof ApiError && error.status === 404;

/** Back to the deck, under this screen if it's there, or in its place when a link opened the app here. */
function seeOtherTopics() {
  router.dismissTo("/deck");
}

/** Where a shared topic link lands: the topic, and a way to join it or pass. */
export default function TopicLinkScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // The route guard sends anyone who isn't set up yet away first, and brings them back after.
  const setUp = Boolean(me?.onboarded && me.termsAccepted);
  const link = useQuery({
    queryKey: ["topicLink", id],
    queryFn: () => api.get<TopicLink>(`/deck/topics/${encodeURIComponent(id)}`),
    enabled: setUp && id !== "",
    retry: (failures, caught) => !notFound(caught) && failures < 1,
  });

  async function refreshAfter<R>(change: Promise<R>): Promise<R | null> {
    setError(null);
    try {
      return await change;
    } catch (caught) {
      setError(friendlyError(caught));
      return null;
    } finally {
      await Promise.all(["topicLink", "topics", "myTopics", "people", "inbox"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    }
  }

  const path = `/deck/topics/${encodeURIComponent(id)}`;
  // A topic someone passed on before takes a join. A swipe would keep the pass.
  const decide = useMutation({
    mutationFn: ({ join, stance }: { join: boolean; stance: Stance | null }) =>
      refreshAfter(
        link.data?.mine === "passed"
          ? api.post<TopicSwipeResult>(`${path}/join`, { stance })
          : api.post<TopicSwipeResult>(`${path}/swipe`, { direction: join ? "right" : "left", stance: join ? stance : null }),
      ),
  });
  const answer = useMutation({ mutationFn: (stance: Stance | null) => refreshAfter(api.post(`${path}/stance`, { stance })) });
  const busy = decide.isPending || answer.isPending;

  if (!setUp || link.isPending) {
    return <ActivityIndicator accessibilityLabel={t("Loading topic", "Chargement du sujet")} size="large" style={styles.loading} />;
  }

  if (!link.data) {
    return (
      <View style={styles.message}>
        {notFound(link.error) ? (
          <>
            <T variant="title">{t("This topic isn't available", "Ce sujet n'est pas disponible")}</T>
            <T muted>
              {t(
                "It may have been removed, still be waiting for review, or be for another city.",
                "Il a peut-être été retiré, il attend peut-être encore d'être approuvé, ou il concerne une autre ville.",
              )}
            </T>
          </>
        ) : (
          <>
            <ErrorText>{t("Couldn't load this topic. Check your connection.", "Impossible de charger ce sujet. Vérifiez votre connexion.")}</ErrorText>
            <Button label={t("Try again", "Réessayer")} kind="secondary" onPress={() => link.refetch()} />
          </>
        )}
        <Button label={t("See other topics", "Voir d'autres sujets")} kind="quiet" onPress={seeOtherTopics} />
      </View>
    );
  }

  const { topic, mine, stance, groupConversationId } = link.data;

  function chooseStance(next: Stance | null) {
    if (busy) return;
    // Joined already: the tap changes or clears the answer. Otherwise it joins with it, like in the deck.
    if (mine === "joined") answer.mutate(next);
    else if (next) decide.mutate({ join: true, stance: next });
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.flyer}>
          <Flyer topic={topic} stance={mine === "joined" ? stance : null} onStance={chooseStance} />
        </View>
        {error ? <ErrorText>{error}</ErrorText> : null}

        {mine === null ? (
          <DeckControls
            leftLabel={PASS_LABEL}
            rightLabel={IN_LABEL}
            onLeft={() => !busy && decide.mutate({ join: false, stance: null })}
            onRight={() => !busy && decide.mutate({ join: true, stance: null })}
          />
        ) : mine === "passed" ? (
          <View style={styles.status}>
            <T variant="bodyBold">{t("You passed on this topic.", "Vous avez passé ce sujet.")}</T>
            <Button label={IN_LABEL} busy={decide.isPending} disabled={busy} onPress={() => decide.mutate({ join: true, stance: null })} />
          </View>
        ) : (
          <View style={styles.status}>
            <T variant="bodyBold">
              {groupConversationId
                ? t("You're in. Your group is open.", "Vous en êtes. Votre groupe est ouvert.")
                : topic.pending
                  ? t("You're in. It's waiting for review before it can form a group.", "Vous en êtes. Il attend d'être approuvé avant de pouvoir former un groupe.")
                  : t("You're in. Waiting for a group.", "Vous en êtes. En attente d'un groupe.")}
            </T>
            {groupConversationId ? (
              <Button label={t("Open the group", "Ouvrir le groupe")} onPress={() => router.push(`/chat/${groupConversationId}`)} />
            ) : topic.pending ? null : (
              <Button label={t("Invite a friend", "Inviter quelqu'un")} kind="secondary" onPress={() => inviteToTopic(topic)} />
            )}
            <Button label={t("Your topics", "Vos sujets")} kind="quiet" onPress={() => router.push("/topics")} />
          </View>
        )}
        <Button label={t("See other topics", "Voir d'autres sujets")} kind="quiet" onPress={seeOtherTopics} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1 },
  message: { flex: 1, padding: 24, gap: 16, justifyContent: "center" },
  screen: { flex: 1 },
  body: { padding: 16, gap: 12, flexGrow: 1 },
  // The flyer fills its space, so it needs a height of its own inside a scroll view.
  flyer: { height: 480 },
  status: { gap: 8 },
});
