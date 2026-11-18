import type { SignedInPhone } from "@babillard/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, FlatList, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { useAuth } from "@/auth";
import { ensureDeviceKey } from "@/e2ee";
import { describeWhen } from "@/format";
import { t } from "@/i18n";
import { registerForPush } from "@/push";
import { useTheme } from "@/theme";
import { Button, ErrorText, T } from "@/ui";

function confirmRetire(): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      t("Retire this phone?", "Retirer ce téléphone?"),
      t(
        "It stops getting messages and leaves your chats. Your other phones are signed out too, so a lost phone can't come back. They keep their messages and sign in again with a code by email.",
        "Il ne recevra plus de messages et quittera vos conversations. Vos autres téléphones seront aussi déconnectés, pour qu'un téléphone perdu ne puisse pas revenir. Ils gardent leurs messages et se reconnectent avec un code par courriel.",
      ),
      [
        { text: t("Cancel", "Annuler"), style: "cancel", onPress: () => resolve(false) },
        { text: t("Retire", "Retirer"), style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

/** The person's signed-in phones, so they can retire one they've lost. */
export default function Phones() {
  const { me } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const phones = useQuery({ queryKey: ["phones"], queryFn: () => api.get<SignedInPhone[]>("/me/devices") });
  const thisPhone = useQuery({ queryKey: ["this-phone", me?.id], queryFn: async () => (await ensureDeviceKey(me!.id)).publicKey, enabled: !!me });
  const retire = useMutation({
    mutationFn: (publicKey: string) => api.post("/me/devices/retire", { publicKey, thisDevice: thisPhone.data }),
    onSuccess: async () => {
      // Retiring clears every push token, this phone's included.
      void registerForPush();
      await queryClient.invalidateQueries({ queryKey: ["phones"] });
    },
  });

  async function onRetire(publicKey: string) {
    if (await confirmRetire()) retire.mutate(publicKey);
  }

  const mine = thisPhone.data;
  const sorted = [...(phones.data ?? [])].sort((a, b) => Number(b.publicKey === mine) - Number(a.publicKey === mine));

  return (
    <FlatList
      data={sorted}
      keyExtractor={(item) => item.publicKey}
      contentContainerStyle={styles.body}
      ListHeaderComponent={
        <View style={styles.header}>
          <T muted>
            {t(
              "Each phone signed in to your account gets your messages. If you've lost one, retire it here.",
              "Chaque téléphone connecté à votre compte reçoit vos messages. Si vous en avez perdu un, retirez-le ici.",
            )}
          </T>
          {phones.isError ? <ErrorText>{friendlyError(phones.error)}</ErrorText> : null}
          {retire.isError ? <ErrorText>{friendlyError(retire.error)}</ErrorText> : null}
        </View>
      }
      renderItem={({ item }) => {
        const isThis = item.publicKey === mine;
        return (
          <View style={[styles.row, { borderBottomColor: theme.line }]}>
            <View style={styles.text}>
              <T variant="bodyBold">{isThis ? t("This phone", "Ce téléphone") : t("Another phone", "Un autre téléphone")}</T>
              <T variant="small" muted>
                {t("Last opened", "Dernière ouverture")} {describeWhen(item.lastOpenedAt)}
              </T>
            </View>
            {isThis || !mine ? null : <Button label={t("Retire", "Retirer")} kind="danger" busy={retire.isPending && retire.variables === item.publicKey} disabled={retire.isPending} onPress={() => void onRetire(item.publicKey)} />}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  body: { padding: 20 },
  header: { gap: 12, paddingBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  text: { flex: 1, gap: 2 },
});
