import { securityCode, type ConversationDetail, type Stance } from "@ideas-match/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { api } from "@/api";
import { useAuth } from "@/auth";
import { inviteToTopic } from "@/invite";
import { fonts, useTheme } from "@/theme";
import { Avatar, Button, T } from "@/ui";
import { t } from "@/i18n";

const STANCE_LABELS: Record<Stance, string> = { for: t("For", "Pour"), against: t("Against", "Contre"), unsure: t("Not sure", "Incertain") };

function StanceSpread({ spread }: { spread: Record<Stance, number> }) {
  const theme = useTheme();
  const total = spread.for + spread.against + spread.unsure;
  if (total === 0) return null;
  const shades: Record<Stance, string> = { for: theme.ink, against: theme.accent, unsure: theme.line };
  const stances = Object.keys(STANCE_LABELS) as Stance[];
  return (
    <View style={styles.section}>
      <T variant="heading">{t("Where this group leans", "Les positions du groupe")}</T>
      <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {stances.map((stance) => (spread[stance] > 0 ? <View key={stance} style={{ flex: spread[stance], backgroundColor: shades[stance] }} /> : null))}
      </View>
      <T muted>{stances.map((stance) => `${STANCE_LABELS[stance]}: ${spread[stance]}`).join(". ")}.</T>
    </View>
  );
}

export default function ChatInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const conversation = useQuery({ queryKey: ["conversation", id], queryFn: () => api.get<ConversationDetail>(`/conversations/${id}`) });
  const mute = useMutation({
    mutationFn: (muted: boolean) => api.post(`/conversations/${id}/mute`, { muted }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversation", id] }),
  });
  const detail = conversation.data;
  if (!detail) return null;

  function confirmLeave() {
    Alert.alert(t("Leave this group?", "Quitter ce groupe?"), t("You won't be able to come back to it.", "Vous ne pourrez pas y revenir."), [
      { text: t("Stay", "Rester"), style: "cancel" },
      {
        text: t("Leave group", "Quitter le groupe"),
        style: "destructive",
        onPress: async () => {
          await api.post(`/conversations/${id}/leave`);
          await queryClient.invalidateQueries({ queryKey: ["inbox"] });
          router.replace("/inbox");
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <T variant="title">{detail.topic?.title ?? detail.title}</T>
      {detail.stanceSpread ? <StanceSpread spread={detail.stanceSpread} /> : null}

      <View style={styles.section}>
        <T variant="heading">{detail.kind === "group" ? t(`${detail.members.length} people`, `${detail.members.length} personnes`) : t("In this chat", "Dans cette conversation")}</T>
        {detail.members.map((member) => {
          const isMe = member.id === me?.id;
          return (
            <Pressable
              key={member.id}
              disabled={isMe}
              accessibilityRole={isMe ? "text" : "button"}
              onPress={() => router.push(`/member/${id}/${member.id}`)}
              style={[styles.member, { borderBottomColor: theme.line }]}
            >
              <Avatar name={member.displayName} url={member.avatarUrl} />
              <T variant="bodyBold">{isMe ? t(`${member.displayName} (you)`, `${member.displayName} (vous)`) : member.displayName}</T>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.section}>
        <T variant="heading">{t("Security code", "Code de sécurité")}</T>
        <T style={styles.code} selectable>
          {securityCode(detail.members.flatMap((member) => member.deviceKeys))}
        </T>
        <T variant="small" muted>
          {t("Messages here are end-to-end encrypted. Compare this code when you meet. If it matches, only the people in this chat can read them.", "Les messages sont chiffrés de bout en bout. Comparez ce code quand vous vous rencontrez. S'il est identique, seules les personnes de cette conversation peuvent les lire.")}
        </T>
      </View>

      <View style={styles.setting}>
        <T variant="bodyBold">{t("Mute notifications", "Couper les notifications")}</T>
        <Switch accessibilityLabel={t("Mute notifications", "Couper les notifications")} value={detail.muted} onValueChange={(value) => mute.mutate(value)} />
      </View>

      {detail.kind === "group" && detail.topic ? <Button label={t("Invite someone to this topic", "Inviter quelqu'un à ce sujet")} kind="secondary" onPress={() => inviteToTopic(detail.topic!)} /> : null}
      {detail.kind === "group" ? <Button label={t("Leave group", "Quitter le groupe")} kind="danger" onPress={confirmLeave} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  code: { fontFamily: fonts.bodyBold, fontSize: 18, letterSpacing: 1 },
  body: { padding: 20, gap: 22 },
  section: { gap: 8 },
  bar: { flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden" },
  member: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth },
  setting: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
});
