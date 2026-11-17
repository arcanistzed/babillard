import { REPORT_REASONS, type BlockResult, type ChatMessage, type ReportReason, type SharedGroup } from "@babillard/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { useAuth } from "@/auth";
import { readingKeys, readMessage } from "@/e2ee";
import { useTheme } from "@/theme";
import { Button, Chip, ChipRow, ErrorText, Field, FormScreen, T } from "@/ui";
import { t } from "@/i18n";

const REASON_LABELS: Record<ReportReason, string> = {
  harassment: t("Harassment", "Harcèlement"),
  spam: t("Spam", "Pourriel"),
  fake_profile: t("Fake profile", "Faux profil"),
  underage: t("May be under 18", "A peut-être moins de 18 ans"),
  intimate_images: t("Intimate images", "Images intimes"),
  safety: t("I feel unsafe", "Je ne me sens pas en sécurité"),
  other: t("Something else", "Autre chose"),
};

export default function Report() {
  const params = useLocalSearchParams<{ targetUserId: string; name: string; conversationId?: string; messageId?: string }>();
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState<"report" | "block" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reported: boolean; blocked: boolean; sharedGroups: SharedGroup[] } | null>(null);

  async function block(): Promise<SharedGroup[]> {
    const result = await api.post<Partial<BlockResult>>(`/safety/blocks/${params.targetUserId}`);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["people"] }),
      queryClient.invalidateQueries({ queryKey: ["inbox"] }),
      queryClient.invalidateQueries({ queryKey: ["conversation"] }),
      queryClient.invalidateQueries({ queryKey: ["blocked"] }),
    ]);
    return result.sharedGroups ?? [];
  }

  /** The server can't read messages, so this phone reveals the keys for the reported one and its neighbours. */
  async function collectEvidence() {
    if (!params.conversationId || !me) return [];
    try {
      const keys = await readingKeys(me.id);
      const nearby = await api.get<ChatMessage[]>(`/conversations/${params.conversationId}/messages?around=${params.messageId ?? ""}&reporting=${params.targetUserId}`);
      // Without anything this person wrote, the nearby messages are only bystanders', so none are shared.
      if (!nearby.some((message) => message.senderId === params.targetUserId)) return [];
      return nearby.flatMap((message) => {
        const { contentKey } = readMessage(message, params.conversationId!, keys);
        return contentKey ? [{ messageId: message.id, contentKey }] : [];
      });
    } catch {
      return [];
    }
  }

  async function run(kind: "report" | "block", action: () => Promise<{ blocked: boolean; sharedGroups: SharedGroup[] }>) {
    setBusy(kind);
    setError(null);
    try {
      const outcome = await action();
      setDone({ reported: kind === "report", ...outcome });
    } catch (caught) {
      setError(friendlyError(caught));
      setBusy(null);
    }
  }

  if (done) return <Done name={params.name} {...done} />;

  return (
    <FormScreen>
        <T variant="title">{t(`What's wrong with ${params.name}?`, `Quel est le problème avec ${params.name}?`)}</T>
        <T muted>{t(`${params.name} won't be told.`, `${params.name} n'en saura rien.`)}{params.conversationId ? t(" Your phone will share the nearby messages with a moderator.", " Votre téléphone transmettra à l'équipe de modération les messages autour du signalement.") : ""}</T>
        <ChipRow accessibilityRole="radiogroup">
          {REPORT_REASONS.map((value) => (
            <Chip key={value} role="radio" label={REASON_LABELS[value]} selected={reason === value} onPress={() => setReason(value)} />
          ))}
        </ChipRow>
        <Field label={t("Anything else we should know?", "Autre chose à nous dire?")} value={note} onChangeText={setNote} multiline maxLength={1000} style={styles.note} />
        <Chip role="checkbox" label={t(`Also block ${params.name}`, `Bloquer aussi ${params.name}`)} selected={alsoBlock} onPress={() => setAlsoBlock(!alsoBlock)} />
        {error ? <ErrorText>{error}</ErrorText> : null}
      <Button
          label={t("Send report", "Envoyer le signalement")}
          disabled={!reason || busy !== null}
          busy={busy === "report"}
          onPress={() =>
            run("report", async () => {
              await api.post("/safety/reports", {
                targetUserId: params.targetUserId,
                reason,
                note: note.trim(),
                evidence: await collectEvidence(),
                ...(params.conversationId ? { conversationId: params.conversationId } : {}),
                ...(params.messageId ? { messageId: params.messageId } : {}),
              });
              return alsoBlock ? { blocked: true, sharedGroups: await block() } : { blocked: false, sharedGroups: [] };
            })
          }
        />
        <Button label={t(`Just block ${params.name}`, `Bloquer ${params.name} sans signaler`)} kind="danger" disabled={busy !== null} busy={busy === "block"} onPress={() => run("block", async () => ({ blocked: true, sharedGroups: await block() }))} />
    </FormScreen>
  );
}

/** Confirms what happened and, after a block, offers to leave groups the two people still share. */
function Done({ name, reported, blocked, sharedGroups }: { name: string; reported: boolean; blocked: boolean; sharedGroups: SharedGroup[] }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remaining = sharedGroups.filter((group) => !left.has(group.id));

  function confirmLeave(group: SharedGroup) {
    Alert.alert(t(`Leave ${group.title}?`, `Quitter ${group.title}?`), t("You won't be able to come back to it.", "Vous ne pourrez pas y revenir."), [
      { text: t("Stay", "Rester"), style: "cancel" },
      {
        text: t("Leave group", "Quitter le groupe"),
        style: "destructive",
        onPress: async () => {
          setLeaving(group.id);
          setError(null);
          try {
            await api.post(`/conversations/${group.id}/leave`);
            setLeft((current) => new Set(current).add(group.id));
            await queryClient.invalidateQueries({ queryKey: ["inbox"] });
          } catch (caught) {
            setError(friendlyError(caught));
          } finally {
            setLeaving(null);
          }
        },
      },
    ]);
  }

  return (
    <FormScreen>
      <T variant="title" accessibilityRole="header">
        {reported ? t("Report sent", "Signalement envoyé") : t(`You blocked ${name}`, `Vous avez bloqué ${name}`)}
      </T>
      {reported ? <T>{t(`Thanks for telling us. A moderator will look at it, and ${name} won't be told who reported them.`, `Merci de votre signalement. L'équipe de modération va l'examiner, et ${name} ne saura pas qui l'a fait.`)}</T> : null}
      {blocked ? (
        <T>
          {t(
            `${reported ? `You also blocked ${name}. ` : ""}You won't see each other's cards, new messages or profiles, and you won't be put in a new group together.`,
            `${reported ? `Vous avez aussi bloqué ${name}. ` : ""}Vous ne verrez plus vos cartes, vos nouveaux messages ni vos profils respectifs, et aucun nouveau groupe ne vous réunira.`,
          )}
        </T>
      ) : null}
      {sharedGroups.length ? (
        <View style={styles.groups}>
          <T variant="heading">{t("Groups you're both still in", "Groupes que vous avez encore en commun")}</T>
          <T muted>
            {t(
              `${name} can still see the meetup plans made in these groups, including the time and place. Leave a group to keep its plans away from them.`,
              `${name} peut encore voir les rencontres prévues dans ces groupes, y compris l'heure et le lieu. Quittez un groupe pour que ses projets lui restent cachés.`,
            )}
          </T>
          {sharedGroups.map((group) => (
            <View key={group.id} style={[styles.group, { borderBottomColor: theme.line }]}>
              <T variant="bodyBold" style={styles.groupTitle}>
                {group.title}
              </T>
              {left.has(group.id) ? (
                <T muted>{t("Left", "Quitté")}</T>
              ) : (
                <Button label={t("Leave", "Quitter")} kind="danger" busy={leaving === group.id} disabled={leaving !== null} onPress={() => confirmLeave(group)} />
              )}
            </View>
          ))}
          {remaining.length === 0 ? <T muted>{t("You've left every group you shared.", "Vous avez quitté tous les groupes que vous partagiez.")}</T> : null}
        </View>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button
        label={t("Done", "Terminé")}
        disabled={leaving !== null}
        onPress={() => {
          router.dismissAll();
          router.replace("/inbox");
        }}
      />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  note: { minHeight: 88, textAlignVertical: "top" },
  groups: { gap: 10 },
  group: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth },
  groupTitle: { flex: 1 },
});
