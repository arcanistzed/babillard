import type { Field, LookingFor, Role } from "@babillard/shared";
import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { api } from "@/api";
import { fonts, useTheme } from "@/theme";
import { Avatar, Button, Chip, ChipRow, ErrorText, T } from "@/ui";
import { fieldLabel, lookingForLabel, nameWithAge, roleLabel, t } from "@/i18n";

interface MemberProfile {
  id: string;
  displayName: string;
  age: number | null;
  bio: string;
  role: Role;
  avatarUrl: string | null;
  verifiedInstitution: boolean;
  fields: Field[];
  lookingFor: LookingFor[];
}

export default function Member() {
  const { conversationId, userId } = useLocalSearchParams<{ conversationId: string; userId: string }>();
  const theme = useTheme();
  const profile = useQuery({ queryKey: ["member", conversationId, userId], queryFn: () => api.get<MemberProfile>(`/conversations/${conversationId}/members/${userId}`) });
  const person = profile.data;

  if (profile.isError) return <View style={styles.body}><ErrorText>{t("Couldn't load this profile.", "Impossible de charger ce profil.")}</ErrorText></View>;
  if (!person) return <ActivityIndicator accessibilityLabel={t("Loading profile", "Chargement du profil")} size="large" style={styles.loading} />;

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: person.displayName }} />
      <Avatar name={person.displayName} url={person.avatarUrl} size={110} />
      <View>
        <T variant="title">{nameWithAge(person.displayName, person.age)}</T>
        <T muted>{roleLabel(person.role)}</T>
        {person.verifiedInstitution ? (
          <T variant="small" style={{ color: theme.good, fontFamily: fonts.bodyBold }}>
            {t("Verified school email", "Courriel scolaire vérifié")}
          </T>
        ) : null}
      </View>
      {person.bio ? <T>{person.bio}</T> : null}
      <View style={styles.section}>
        <T variant="heading">{t("Looking for", "Recherche")}</T>
        <ChipRow>{person.lookingFor.map((item) => <Chip key={item} label={lookingForLabel(item)} />)}</ChipRow>
      </View>
      <View style={styles.section}>
        <T variant="heading">{t("Into", "Intérêts")}</T>
        <ChipRow>{person.fields.map((item) => <Chip key={item} label={fieldLabel(item)} />)}</ChipRow>
      </View>
      <Button label={t("Report or block", "Signaler ou bloquer")} kind="danger" onPress={() => router.push({ pathname: "/report", params: { targetUserId: person.id, name: person.displayName, conversationId } })} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1 },
  body: { padding: 20, gap: 18 },
  section: { gap: 8 },
});
