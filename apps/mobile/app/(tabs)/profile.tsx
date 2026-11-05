import { LOOKING_FOR_LABELS, ROLE_LABELS } from "@ideas-match/shared";
import type { Locality } from "@ideas-match/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, friendlyError, uploadAvatar } from "@/api";
import { useAuth } from "@/auth";
import { pickAndResizePhoto } from "@/components/PhotoPicker";
import { fonts, useTheme } from "@/theme";
import { Avatar, Button, Chip, ChipRow, ErrorText, T } from "@/ui";

export default function Profile() {
  const { me, refresh, signOut, forgetSession } = useAuth();
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);
  const localities = useQuery({ queryKey: ["localities"], queryFn: () => api.get<Locality[]>("/me/localities") });
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
    Alert.alert("Delete your account?", "This removes your profile, your swipes, and everything you've written. You can't undo it.", [
      { text: "Keep my account", style: "cancel" },
      {
        text: "Delete account",
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete("/me");
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
        <Pressable accessibilityRole="button" accessibilityLabel="Change your photo" onPress={changePhoto} style={styles.identity}>
          <Avatar name={profile.displayName} url={profile.avatarUrl} size={96} />
          <View style={styles.identityText}>
            <T variant="title">{profile.displayName}</T>
            <T muted>{ROLE_LABELS[profile.role]}</T>
            {place ? <T muted>{place}</T> : null}
            {me.verifiedInstitution ? (
              <T variant="small" style={{ color: theme.good, fontFamily: fonts.bodyBold }}>
                Verified with {me.institutionDomain}
              </T>
            ) : null}
          </View>
        </Pressable>
        {profile.bio ? <T>{profile.bio}</T> : null}

        <View style={styles.section}>
          <T variant="heading">Looking for</T>
          <ChipRow>{profile.lookingFor.map((item) => <Chip key={item} label={LOOKING_FOR_LABELS[item]} />)}</ChipRow>
        </View>

        {error ? <ErrorText>{error}</ErrorText> : null}

        <View style={styles.actions}>
          <Button label="Edit profile" kind="secondary" onPress={() => router.push("/profile-edit")} />
          <Button label="Suggest a topic" kind="secondary" onPress={() => router.push("/topic/new")} />
          <Button label="Invite a friend" kind="secondary" onPress={() => void Share.share({ message: `Come talk ideas with me on Ideas Match: ${process.env.EXPO_PUBLIC_API_URL}/invite` })} />
          <Button label="Blocked people" kind="quiet" onPress={() => router.push("/blocked")} />
          <Button label="Sign out" kind="quiet" onPress={signOut} />
          <Button label="Delete account" kind="danger" onPress={confirmDelete} />
        </View>
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
});
