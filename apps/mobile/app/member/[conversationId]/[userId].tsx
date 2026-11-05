import { FIELD_LABELS, LOOKING_FOR_LABELS, ROLE_LABELS, type Field, type LookingFor, type Role } from "@ideas-match/shared";
import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { api } from "@/api";
import { fonts, useTheme } from "@/theme";
import { Avatar, Button, Chip, ChipRow, ErrorText, T } from "@/ui";

interface MemberProfile {
  id: string;
  displayName: string;
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

  if (profile.isError) return <View style={styles.body}><ErrorText>Couldn't load this profile.</ErrorText></View>;
  if (!person) return <ActivityIndicator accessibilityLabel="Loading profile" size="large" style={styles.loading} />;

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: person.displayName }} />
      <Avatar name={person.displayName} url={person.avatarUrl} size={110} />
      <View>
        <T variant="title">{person.displayName}</T>
        <T muted>{ROLE_LABELS[person.role]}</T>
        {person.verifiedInstitution ? (
          <T variant="small" style={{ color: theme.good, fontFamily: fonts.bodyBold }}>
            Verified school email
          </T>
        ) : null}
      </View>
      {person.bio ? <T>{person.bio}</T> : null}
      <View style={styles.section}>
        <T variant="heading">Looking for</T>
        <ChipRow>{person.lookingFor.map((item) => <Chip key={item} label={LOOKING_FOR_LABELS[item]} />)}</ChipRow>
      </View>
      <View style={styles.section}>
        <T variant="heading">Into</T>
        <ChipRow>{person.fields.map((item) => <Chip key={item} label={FIELD_LABELS[item]} />)}</ChipRow>
      </View>
      <Button label="Report or block" kind="danger" onPress={() => router.push({ pathname: "/report", params: { targetUserId: person.id, name: person.displayName, conversationId } })} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1 },
  body: { padding: 20, gap: 18 },
  section: { gap: 8 },
});
