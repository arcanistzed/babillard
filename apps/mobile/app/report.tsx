import { REPORT_REASONS, type ChatMessage, type ReportReason } from "@ideas-match/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet } from "react-native";
import { api, friendlyError } from "@/api";
import { useAuth } from "@/auth";
import { readingKeys, readMessage } from "@/e2ee";
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

  async function block() {
    await api.post(`/safety/blocks/${params.targetUserId}`);
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["people"] }), queryClient.invalidateQueries({ queryKey: ["inbox"] })]);
  }

  /** The server can't read messages, so this phone reveals the keys for the reported one and its neighbours. */
  async function collectEvidence() {
    if (!params.conversationId || !me) return [];
    try {
      const keys = await readingKeys(me.id);
      const nearby = await api.get<ChatMessage[]>(`/conversations/${params.conversationId}/messages?around=${params.messageId ?? ""}`);
      return nearby.flatMap((message) => {
        const { contentKey } = readMessage(message, params.conversationId!, keys);
        return contentKey ? [{ messageId: message.id, contentKey }] : [];
      });
    } catch {
      return [];
    }
  }

  async function run(kind: "report" | "block", action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
      router.dismissAll();
      router.replace("/inbox");
    } catch (caught) {
      setError(friendlyError(caught));
      setBusy(null);
    }
  }

  return (
    <FormScreen>
        <T variant="title">{t(`What's wrong with ${params.name}?`, `Quel est le problème avec ${params.name}?`)}</T>
        <T muted>{t(`${params.name} won't be told.`, `${params.name} n'en sera pas informé.`)}{params.conversationId ? t(" Your phone will share the nearby messages with a moderator.", " Votre téléphone transmettra les messages voisins à un modérateur.") : ""}</T>
        <ChipRow>
          {REPORT_REASONS.map((value) => (
            <Chip key={value} label={REASON_LABELS[value]} selected={reason === value} onPress={() => setReason(value)} />
          ))}
        </ChipRow>
        <Field label={t("Anything else we should know?", "Autre chose à nous dire?")} value={note} onChangeText={setNote} multiline maxLength={1000} style={styles.note} />
        <Chip label={t(`Also block ${params.name}`, `Bloquer aussi ${params.name}`)} selected={alsoBlock} onPress={() => setAlsoBlock(!alsoBlock)} />
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
              if (alsoBlock) await block();
            })
          }
        />
        <Button label={t(`Just block ${params.name}`, `Seulement bloquer ${params.name}`)} kind="danger" disabled={busy !== null} busy={busy === "block"} onPress={() => run("block", block)} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  note: { minHeight: 88, textAlignVertical: "top" },
});
