import type { MyTopic, MyTopics, Stance, TopicSwipeResult } from "@babillard/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, SectionList, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { useTheme } from "@/theme";
import { Button, Chip, ChipRow, ErrorText, T } from "@/ui";
import { t } from "@/i18n";

const STANCE_LABELS: Record<Stance, string> = { for: t("For", "Pour"), against: t("Against", "Contre"), unsure: t("Not sure", "Incertain") };

/** The topics someone joined, with their answer and whether a group opened, and the ones they passed on. */
export default function YourTopics() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const mine = useQuery({ queryKey: ["myTopics"], queryFn: () => api.get<MyTopics>("/deck/mine") });

  async function refreshAfter<T>(change: Promise<T>): Promise<T | null> {
    setError(null);
    try {
      return await change;
    } catch (caught) {
      setError(friendlyError(caught));
      return null;
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["myTopics"] }),
        queryClient.invalidateQueries({ queryKey: ["people"] }),
        queryClient.invalidateQueries({ queryKey: ["topics"] }),
      ]);
    }
  }

  const answer = useMutation({ mutationFn: ({ topic, stance }: { topic: MyTopic; stance: Stance | null }) => refreshAfter(api.post(`/deck/topics/${topic.id}/stance`, { stance })) });
  const leave = useMutation({ mutationFn: (topic: MyTopic) => refreshAfter(api.post(`/deck/topics/${topic.id}/leave`)) });
  const join = useMutation({
    mutationFn: async (topic: MyTopic) => {
      const result = await refreshAfter(api.post<TopicSwipeResult>(`/deck/topics/${topic.id}/join`, { stance: null }));
      if (result?.groupConversationId) {
        await queryClient.invalidateQueries({ queryKey: ["inbox"] });
        router.push(`/chat/${result.groupConversationId}`);
      }
    },
  });
  const busy = answer.isPending || leave.isPending || join.isPending;

  function confirmLeave(topic: MyTopic) {
    Alert.alert(
      t("Leave this topic?", "Quitter ce sujet?"),
      t("You'll come off the waiting list for a group. You can join again from the topics you passed.", "Vous quitterez la liste d'attente pour un groupe. Vous pourrez le rejoindre depuis les sujets que vous avez passés."),
      [
        { text: t("Stay", "Rester"), style: "cancel" },
        { text: t("Leave topic", "Quitter le sujet"), style: "destructive", onPress: () => leave.mutate(topic) },
      ],
    );
  }

  if (mine.isPending) return <ActivityIndicator accessibilityLabel={t("Loading your topics", "Chargement de vos sujets")} size="large" style={styles.loading} />;
  if (!mine.data) {
    return (
      <View style={styles.body}>
        <ErrorText>{t("Couldn't load your topics. Check your connection.", "Impossible de charger vos sujets. Vérifiez votre connexion.")}</ErrorText>
        <Button label={t("Try again", "Réessayer")} kind="secondary" onPress={() => mine.refetch()} />
      </View>
    );
  }

  const sections = [
    { key: "joined", title: t("Topics you joined", "Sujets que vous avez choisis"), data: mine.data.joined },
    ...(mine.data.passed.length ? [{ key: "passed", title: t("Topics you passed", "Sujets que vous avez passés"), data: mine.data.passed }] : []),
  ];

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.body}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={error ? <ErrorText>{error}</ErrorText> : undefined}
      renderSectionHeader={({ section }) => (
        <View style={styles.header}>
          <T variant="heading">{section.title}</T>
          {section.key === "joined" && section.data.length === 0 ? <T muted>{t("You haven't joined a topic yet. Swipe right on one in Topics.", "Vous n'avez encore choisi aucun sujet. Glissez vers la droite sur un sujet dans Sujets.")}</T> : null}
        </View>
      )}
      renderItem={({ item, section }) => (
        <View style={[styles.row, { borderBottomColor: theme.line }]}>
          <T variant="bodyBold">{item.title}</T>
          {section.key === "passed" ? (
            <Button label={t("Join this topic", "Choisir ce sujet")} kind="secondary" disabled={busy} onPress={() => join.mutate(item)} />
          ) : (
            <>
              <T muted>
                {item.groupConversationId
                  ? t("Your group is open", "Votre groupe est ouvert")
                  : item.pending
                    ? t("Waiting for review before it can form a group", "En attente d'approbation avant de pouvoir former un groupe")
                    : t("Waiting for a group", "En attente d'un groupe")}
              </T>
              {item.kind === "question" ? (
                <View style={styles.answer}>
                  <T variant="small" muted>
                    {t("Your answer. Nobody else sees it, and you can change it or leave it blank.", "Votre réponse. Personne d'autre ne la voit, et vous pouvez la changer ou la laisser vide.")}
                  </T>
                  <ChipRow accessibilityRole="radiogroup">
                    {(Object.keys(STANCE_LABELS) as Stance[]).map((stance) => (
                      <Chip
                        key={stance}
                        role="radio"
                        label={STANCE_LABELS[stance]}
                        selected={item.stance === stance}
                        disabled={busy}
                        onPress={() => answer.mutate({ topic: item, stance: item.stance === stance ? null : stance })}
                      />
                    ))}
                  </ChipRow>
                </View>
              ) : null}
              {item.groupConversationId ? (
                <Button label={t("Open the group", "Ouvrir le groupe")} kind="secondary" onPress={() => router.push(`/chat/${item.groupConversationId}`)} />
              ) : (
                <Button label={t("Leave topic", "Quitter le sujet")} kind="quiet" disabled={busy} onPress={() => confirmLeave(item)} />
              )}
            </>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1 },
  body: { padding: 20, gap: 4 },
  header: { gap: 6, paddingTop: 12, paddingBottom: 4 },
  row: { gap: 8, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  answer: { gap: 6 },
});
