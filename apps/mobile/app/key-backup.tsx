import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useAuth } from "@/auth";
import { saveBackupFile, restoreFromBackup } from "@/e2ee";
import { t } from "@/i18n";
import { Button, ErrorText, Field, FormScreen, T } from "@/ui";

const MIN_PASSPHRASE = 8;
const FILE_NAME = "ideas-match-key-backup.json";

export default function KeyBackup() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [busy, setBusy] = useState<"save" | "restore" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const userId = me.id;

  async function save(target: "share" | "folder") {
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const contents = await saveBackupFile(userId, passphrase);
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
      setNotice(t("Backup ready. Keep the file and your passphrase somewhere safe.", "Sauvegarde prête. Gardez le fichier et votre phrase secrète en lieu sûr."));
    } catch {
      setError(t("Couldn't save the backup. Try again.", "Impossible d'enregistrer la sauvegarde. Réessayez."));
    } finally {
      setBusy(null);
    }
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
      if (restored) {
        setRestorePassphrase("");
        queryClient.removeQueries({ queryKey: ["inbox"] });
        setNotice(t("Restored. Older messages will open again.", "Clé restaurée. Les anciens messages s'ouvriront de nouveau."));
      } else {
        setError(t("That passphrase didn't open this file.", "Cette phrase secrète n'ouvre pas ce fichier."));
      }
    } catch {
      setError(t("Couldn't read that file.", "Impossible de lire ce fichier."));
    } finally {
      setBusy(null);
    }
  }

  const mismatch = confirm.length > 0 && confirm !== passphrase;
  const canSave = busy === null && passphrase.length >= MIN_PASSPHRASE && passphrase === confirm;
  return (
    <FormScreen>
      <T>{t("Your messages can only be opened with a key on this phone. Save a backup to read them on a new phone. Your passphrase protects the file.", "Vos messages ne s'ouvrent qu'avec une clé sur ce téléphone. Faites une sauvegarde pour les lire sur un nouveau téléphone. Votre phrase secrète protège le fichier.")}</T>
      <View style={styles.section}>
        <T variant="heading">{t("Save a backup", "Faire une sauvegarde")}</T>
        <Field label={t("Passphrase, at least 8 characters", "Phrase secrète, au moins 8 caractères")} value={passphrase} onChangeText={setPassphrase} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <Field label={t("Type it again", "Retapez-la")} value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" error={mismatch ? t("These don't match.", "Elles ne correspondent pas.") : null} />
        <T variant="small" muted>
          {t("We can't recover a lost passphrase. Save a new backup after you sign in on a new phone.", "Nous ne pouvons pas récupérer une phrase secrète perdue. Refaites une sauvegarde après une connexion sur un nouveau téléphone.")}
        </T>
        <Button label={t("Save to Google Drive or another app", "Enregistrer dans Google Drive ou une autre application")} onPress={() => save("share")} busy={busy === "save"} disabled={!canSave} />
        {Platform.OS === "android" ? <Button label={t("Save to a folder on this phone", "Enregistrer dans un dossier du téléphone")} kind="secondary" onPress={() => save("folder")} disabled={!canSave} /> : null}
      </View>
      <View style={styles.section}>
        <T variant="heading">{t("Restore from a backup", "Restaurer une sauvegarde")}</T>
        <Field label={t("Passphrase", "Phrase secrète")} value={restorePassphrase} onChangeText={setRestorePassphrase} secureTextEntry autoCapitalize="none" />
        <Button label={t("Choose backup file", "Choisir le fichier")} kind="secondary" onPress={restore} busy={busy === "restore"} disabled={busy !== null || restorePassphrase.length === 0} />
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {notice ? <T accessibilityLiveRegion="polite">{notice}</T> : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
});
