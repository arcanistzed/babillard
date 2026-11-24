import { Ionicons } from "@expo/vector-icons";
import * as Application from "expo-application";
import { router } from "expo-router";
import * as Updates from "expo-updates";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, friendlyError, uploadAvatar } from "@/api";
import { useAuth } from "@/auth";
import { useLocalities } from "@/components/CityPicker";
import { pickAndResizePhoto } from "@/components/PhotoPicker";
import { inviteToApp } from "@/invite";
import { openLegalPage, openSourceCode } from "@/legal";
import { fonts, useTheme } from "@/theme";
import { Avatar, Button, ErrorText, Row, RowGroup, T } from "@/ui";
import { nameWithAge, roleLabel, t } from "@/i18n";

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
        <Pressable
          accessibilityRole="button"
          // A label replaces what's inside, so it carries the name and details shown next to the photo.
          accessibilityLabel={[nameWithAge(profile.displayName, me.age), roleLabel(profile.role), place, me.verifiedInstitution ? `${t("Verified with", "Courriel scolaire vérifié:")} ${me.institutionDomain}` : ""].filter(Boolean).join(". ")}
          accessibilityHint={t("Changes your photo", "Change votre photo")}
          onPress={changePhoto}
          style={styles.identity}
        >
          <View>
            <Avatar name={profile.displayName} url={profile.avatarUrl} size={88} />
            <View style={[styles.camera, { backgroundColor: theme.ink, borderColor: theme.paper }]}>
              <Ionicons name="camera" size={16} color={theme.paper} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            </View>
          </View>
          <View style={styles.identityText}>
            <T variant="title">{nameWithAge(profile.displayName, me.age)}</T>
            <T muted>{roleLabel(profile.role)}</T>
            {place ? <T muted>{place}</T> : null}
            {me.verifiedInstitution ? (
              <T variant="small" style={{ color: theme.good, fontFamily: fonts.bodyBold }}>
                {t("Verified with", "Courriel scolaire vérifié:")} {me.institutionDomain}
              </T>
            ) : null}
          </View>
        </Pressable>
        {profile.bio ? <T>{profile.bio}</T> : null}

        {error ? <ErrorText>{error}</ErrorText> : null}

        <View style={styles.actions}>
          <Button label={t("Edit profile", "Modifier le profil")} kind="secondary" onPress={() => router.push("/profile-edit")} />
          <Button label={t("Invite a friend", "Inviter quelqu'un")} onPress={inviteToApp} />
        </View>

        <RowGroup>
          <Row first label={t("Your topics", "Vos sujets")} onPress={() => router.push("/topics")} />
          <Row label={t("Suggest a topic", "Suggérer un sujet")} onPress={() => router.push("/topic/new")} />
        </RowGroup>
        <RowGroup title={t("Privacy and security", "Confidentialité et sécurité")}>
          <Row first label={t("Blocked people", "Personnes bloquées")} onPress={() => router.push("/blocked")} />
          <Row label={t("Signed-in phones", "Téléphones connectés")} onPress={() => router.push("/phones")} />
          <Row label={t("Back up messages", "Sauvegarder les messages")} onPress={() => router.push("/key-backup")} />
        </RowGroup>
        <RowGroup title={t("About Babillard", "À propos de Babillard")}>
          {LEGAL_LINKS.map(([label, page], index) => (
            <Row key={page} first={index === 0} role="link" label={label} onPress={() => openLegalPage(page)} />
          ))}
          <Row role="link" label={t("Source code", "Code source")} onPress={openSourceCode} />
        </RowGroup>
        <RowGroup title={t("Account", "Compte")}>
          <Row first acts label={t("Sign out", "Se déconnecter")} onPress={signOut} />
          <Row acts danger label={t("Delete account", "Supprimer le compte")} onPress={confirmDelete} />
        </RowGroup>
        {Application.nativeApplicationVersion ? (
          <T variant="small" muted style={styles.version} selectable>
            {/* The same word in English and French. */}
            Version {Application.nativeApplicationVersion}
            {/* Shown when this launch runs an over-the-air update rather than the code inside the APK. */}
            {!Updates.isEmbeddedLaunch && Updates.createdAt
              ? t(`, updated ${Updates.createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, `, mise à jour le ${Updates.createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`)
              : ""}
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
  camera: { position: "absolute", right: -4, bottom: -4, width: 34, height: 34, borderRadius: 17, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  actions: { gap: 10 },
  version: { textAlign: "center" },
});
