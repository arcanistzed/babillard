import type { InboxItem } from "@babillard/shared";
import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useEffect, useState } from "react";
import { Alert, Platform, StyleSheet, View } from "react-native";
import { api } from "@/api";
import { useAuth } from "@/auth";
import { saveBackupFile, restoreFromBackup } from "@/e2ee";
import { t } from "@/i18n";
import { mlsMessenger, newHistoryKey, storedHistoryKey, storeHistoryKey } from "@/mls";
import { Button, ErrorText, Field, FormScreen, T } from "@/ui";

const MIN_PASSPHRASE = 8;
const FILE_NAME = "babillard-key-backup.json";

/** Asks whether to start over when another of the person's phones already backs up their messages. */
function confirmStartOver(): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      t("Your messages are already backed up", "Vos messages sont déjà sauvegardés"),
      t(
        "Another of your phones backs them up. To keep that history, restore that phone's backup file here instead. Starting over deletes it.",
        "Un autre de vos téléphones les sauvegarde. Pour garder cet historique, restaurez plutôt ici le fichier de sauvegarde de ce téléphone. Recommencer le supprime.",
      ),
      [
        { text: t("Cancel", "Annuler"), style: "cancel", onPress: () => resolve(false) },
        { text: t("Start over", "Recommencer"), style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

export default function KeyBackup() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [busy, setBusy] = useState<"save" | "restore" | "stop" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Whether this phone backs up message history. Null until known. */
  const [historyOn, setHistoryOn] = useState<boolean | null>(null);
  const mls = mlsMessenger(me);

  useEffect(() => {
    if (!me || !mls) return;
    let active = true;
    void mls
      .then(async (messenger) => (await storedHistoryKey(me.id)) !== null && messenger.historyActive())
      .then((on) => active && setHistoryOn(on))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [me, mls]);

  if (!me) return null;
  const userId = me.id;

  /**
   * With MLS on, the file carries the history key and this phone backs up history under it. Null
   * means the file holds device keys only: MLS is off here, or the person chose not to start over.
   */
  async function historyKeyForFile(): Promise<Uint8Array | null | "cancelled"> {
    if (!mls) return storedHistoryKey(userId);
    const messenger = await mls;
    const key = (await storedHistoryKey(userId)) ?? newHistoryKey();
    if ((await messenger.enableHistory(key)) === "exists") {
      if (!(await confirmStartOver())) return "cancelled";
      await messenger.enableHistory(key, true);
    }
    await storeHistoryKey(userId, key);
    setHistoryOn(true);
    return key;
  }

  async function save(target: "share" | "folder") {
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const historyKey = await historyKeyForFile();
      if (historyKey === "cancelled") return;
      const contents = await saveBackupFile(userId, passphrase, historyKey);
      if (target === "folder") {
        const folder = await Directory.pickDirectoryAsync();
        folder.createFile(FILE_NAME, "application/json").write(contents);
      } else {
        const file = new File(Paths.cache, FILE_NAME);
        if (file.exists) file.delete();
        file.create();
        file.write(contents);
        await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: t("Save your key backup", "Enregistrer votre sauvegarde de clé") });
        file.delete();
      }
      setPassphrase("");
      setConfirm("");
      setNotice(t("Backup ready. Keep the file and passphrase safe.", "Sauvegarde prête. Gardez le fichier et la phrase secrète en lieu sûr."));
    } catch {
      setError(t("Couldn't save the backup. Try again.", "Impossible d'enregistrer la sauvegarde. Réessayez."));
    } finally {
      setBusy(null);
    }
  }

  /** Takes up the file's history key, if it's still the person's, and fills in each chat from it. */
  async function restoreHistory(historyKey: Uint8Array): Promise<"restored" | "replaced"> {
    if (!mls) {
      await storeHistoryKey(userId, historyKey);
      return "restored";
    }
    const messenger = await mls;
    // Without `replace`, this only succeeds if the file's key is still the one in use.
    if ((await messenger.enableHistory(historyKey)) === "exists") return "replaced";
    await storeHistoryKey(userId, historyKey);
    setHistoryOn(true);
    const chats = await api.get<InboxItem[]>("/conversations");
    for (const chat of chats) await messenger.restoreHistory(chat.id).catch(() => 0);
    return "restored";
  }

  async function restore() {
    setError(null);
    setNotice(null);
    const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: false });
    const asset = picked.canceled ? undefined : picked.assets[0];
    if (!asset) return;
    setBusy("restore");
    try {
      const restored = await restoreFromBackup(userId, await new File(asset.uri).text(), restorePassphrase);
      if (!restored) {
        setError(t("That passphrase didn't open this file.", "Cette phrase secrète n'ouvre pas ce fichier."));
        return;
      }
      setRestorePassphrase("");
      const history = restored.historyKey ? await restoreHistory(restored.historyKey) : "restored";
      queryClient.removeQueries({ queryKey: ["inbox"] });
      setNotice(
        history === "replaced"
          ? t(
              "Restored. Older messages will open again, but this file's message history was replaced by a newer backup.",
              "Clé restaurée. Les anciens messages s'ouvriront de nouveau, mais l'historique de ce fichier a été remplacé par une sauvegarde plus récente.",
            )
          : t("Restored. Older messages will open again.", "Clé restaurée. Les anciens messages s'ouvriront de nouveau."),
      );
    } catch {
      setError(t("Couldn't read that file.", "Impossible de lire ce fichier."));
    } finally {
      setBusy(null);
    }
  }

  function stop() {
    Alert.alert(
      t("Stop backing up messages?", "Arrêter la sauvegarde des messages ?"),
      t(
        "The copy on our server is deleted. Your backup files will no longer bring back message history.",
        "La copie sur notre serveur est supprimée. Vos fichiers de sauvegarde ne rétabliront plus l'historique des messages.",
      ),
      [
        { text: t("Cancel", "Annuler"), style: "cancel" },
        {
          text: t("Stop", "Arrêter"),
          style: "destructive",
          onPress: () => {
            if (!mls) return;
            setBusy("stop");
            setError(null);
            void mls
              .then((messenger) => messenger.disableHistory())
              .then(() => storeHistoryKey(userId, null))
              .then(() => {
                setHistoryOn(false);
                setNotice(t("Messages are no longer backed up.", "Les messages ne sont plus sauvegardés."));
              })
              .catch(() => setError(t("Couldn't stop it. Try again.", "Impossible d'arrêter. Réessayez.")))
              .finally(() => setBusy(null));
          },
        },
      ],
    );
  }

  const mismatch = confirm.length > 0 && confirm !== passphrase;
  const canSave = busy === null && passphrase.length >= MIN_PASSPHRASE && passphrase === confirm;
  return (
    <FormScreen>
      <T>{t("Messages open only with a key on this phone. Back it up to read them on a new phone.", "Les messages ne s'ouvrent qu'avec une clé sur ce téléphone. Sauvegardez-la pour les lire sur un nouveau téléphone.")}</T>
      {mls ? (
        <T variant="small" muted>
          {t(
            "Your backup also keeps a copy of your messages on our server, sealed with a key that only your backup file holds. Anyone with the file and passphrase could read them. Without a backup, a message can only be read on the phones that received it.",
            "Votre sauvegarde conserve aussi une copie de vos messages sur notre serveur, scellée avec une clé que seul votre fichier de sauvegarde contient. Toute personne ayant le fichier et la phrase secrète pourrait les lire. Sans sauvegarde, un message ne peut être lu que sur les téléphones qui l'ont reçu.",
          )}
        </T>
      ) : null}
      <View style={styles.section}>
        <T variant="heading">{t("Save a backup", "Faire une sauvegarde")}</T>
        <Field label={t("Passphrase, at least 8 characters", "Phrase secrète, au moins 8 caractères")} value={passphrase} onChangeText={setPassphrase} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <Field label={t("Type it again", "Retapez-la")} value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" error={mismatch ? t("These don't match.", "Elles ne correspondent pas.") : null} />
        <T variant="small" muted>
          {t("We can't recover a lost passphrase. Back up again on each new phone.", "Nous ne pouvons pas récupérer une phrase secrète perdue. Refaites une sauvegarde sur chaque nouveau téléphone.")}
        </T>
        <Button label={t("Save to Google Drive or another app", "Enregistrer dans Google Drive ou une autre application")} onPress={() => save("share")} busy={busy === "save"} disabled={!canSave} />
        {Platform.OS === "android" ? <Button label={t("Save to a folder on this phone", "Enregistrer dans un dossier du téléphone")} kind="secondary" onPress={() => save("folder")} disabled={!canSave} /> : null}
      </View>
      <View style={styles.section}>
        <T variant="heading">{t("Restore from a backup", "Restaurer une sauvegarde")}</T>
        <Field label={t("Passphrase", "Phrase secrète")} value={restorePassphrase} onChangeText={setRestorePassphrase} secureTextEntry autoCapitalize="none" />
        <Button label={t("Choose backup file", "Choisir le fichier")} kind="secondary" onPress={restore} busy={busy === "restore"} disabled={busy !== null || restorePassphrase.length === 0} />
      </View>
      {historyOn ? (
        <View style={styles.section}>
          <T variant="heading">{t("Message history", "Historique des messages")}</T>
          <T variant="small" muted>
            {t("This phone backs up your messages.", "Ce téléphone sauvegarde vos messages.")}
          </T>
          <Button label={t("Stop backing up messages", "Arrêter la sauvegarde des messages")} kind="danger" onPress={stop} busy={busy === "stop"} disabled={busy !== null} />
        </View>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {notice ? <T accessibilityLiveRegion="polite">{notice}</T> : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
});
