import * as Application from "expo-application";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, friendlyError, uploadAvatar } from "@/api";
import { useAuth } from "@/auth";
import { useLocalities } from "@/components/CityPicker";
import { pickAndResizePhoto } from "@/components/PhotoPicker";
import { inviteToApp } from "@/invite";
import { openLegalPage } from "@/legal";
import { fonts, useTheme } from "@/theme";
import { Avatar, Button, Chip, ChipRow, ErrorText, T } from "@/ui";
import { lookingForLabel, nameWithAge, roleLabel, t } from "@/i18n";

const LEGAL_LINKS = [
  [t("Privacy policy", "Confidentialité"), "privacy"],
  [t("Terms of use", "Conditions d'utilisation"), "terms"],
  [t("Safety", "Sécurité"), "safety"],
] as const;

export default function Profile() {
  const { me, refresh, signOut, forgetSession, forgetDevice } = useAuth();
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);
  const localities = useLocalities();
  const profile = me?.profile;
  if (!me || !profile) return null;

  const placeOf = (id: string | null) => localities.data?.find((item) => item.id === id)?.name;
  const place = [placeOf(me.campusId), placeOf(me.cityId)].filter(Boolean).join(", ");

  async function changePhoto() {
    setError(null);
    try {
      const uri = await pickAndResizePhoto();
      if (!uri) return;
      await uploadAvatar(uri);
      await refresh();
    } catch (caught) {
      setError(friendlyError(caught));
    }
  }

  function confirmDelete() {
    Alert.alert(t("Delete your account?", "Supprimer votre compte?"), t("This deletes your profile and messages, and can't be undone.", "Cela supprime votre profil et vos messages, et c'est irréversible."), [
      { text: t("Keep my account", "Garder mon compte"), style: "cancel" },
      {
        text: t("Delete account", "Supprimer le compte"),
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete("/me");
            await forgetDevice();
            await forgetSession();
          } catch (caught) {
            setError(friendlyError(caught));
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Change your photo", "Changer votre photo")} onPress={changePhoto} style={styles.identity}>
          <Avatar name={profile.displayName} url={profile.avatarUrl} size={96} />
          <View style={styles.identityText}>
            <T variant="title">{nameWithAge(profile.displayName, me.age)}</T>
            <T muted>{roleLabel(profile.role)}</T>
            {place ? <T muted>{place}</T> : null}
            {me.verifiedInstitution ? (
              <T variant="small" style={{ color: theme.good, fontFamily: fonts.bodyBold }}>
                {t("Verified with", "Vérifié avec")} {me.institutionDomain}
              </T>
            ) : null}
          </View>
        </Pressable>
        {profile.bio ? <T>{profile.bio}</T> : null}

        <View style={styles.section}>
          <T variant="heading">{t("Looking for", "Recherche")}</T>
          <ChipRow>{profile.lookingFor.map((item) => <Chip key={item} label={lookingForLabel(item)} />)}</ChipRow>
        </View>

        {error ? <ErrorText>{error}</ErrorText> : null}

        <View style={styles.actions}>
          <Button label={t("Invite a friend", "Inviter quelqu'un")} onPress={inviteToApp} />
          <Button label={t("Edit profile", "Modifier le profil")} kind="secondary" onPress={() => router.push("/profile-edit")} />
          <Button label={t("Suggest a topic", "Suggérer un sujet")} kind="secondary" onPress={() => router.push("/topic/new")} />
          <Button label={t("Back up messages", "Sauvegarder les messages")} kind="quiet" onPress={() => router.push("/key-backup")} />
          <Button label={t("Blocked people", "Personnes bloquées")} kind="quiet" onPress={() => router.push("/blocked")} />
          <Button label={t("Sign out", "Se déconnecter")} kind="quiet" onPress={signOut} />
          <Button label={t("Delete account", "Supprimer le compte")} kind="danger" onPress={confirmDelete} />
        </View>
        <View style={styles.legal}>
          {LEGAL_LINKS.map(([label, page]) => (
            <Pressable key={page} accessibilityRole="link" hitSlop={8} onPress={() => openLegalPage(page)}>
              <T variant="small" muted>
                {label}
              </T>
            </Pressable>
          ))}
        </View>
        {Application.nativeApplicationVersion ? (
          <T variant="small" muted style={styles.version} selectable>
            {/* The same word in English and French. */}
            Version {Application.nativeApplicationVersion}
          </T>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 20, gap: 18 },
  identity: { flexDirection: "row", gap: 16, alignItems: "center" },
  identityText: { flex: 1, gap: 1 },
  section: { gap: 8 },
  actions: { gap: 10 },
  legal: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 18, paddingVertical: 6 },
  version: { textAlign: "center" },
});
