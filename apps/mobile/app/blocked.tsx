import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { api, friendlyError } from "@/api";
import { useTheme } from "@/theme";
import { Button, ErrorText, LoadError, T, useScrollPadding } from "@/ui";
import { t } from "@/i18n";

export default function Blocked() {
  const theme = useTheme();
  const padding = useScrollPadding();
  const queryClient = useQueryClient();
  const blocked = useQuery({ queryKey: ["blocked"], queryFn: () => api.get<{ id: string; displayName: string }[]>("/safety/blocks") });
  const unblock = useMutation({
    mutationFn: (id: string) => api.delete(`/safety/blocks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["blocked"] }),
  });

  if (blocked.isPending) return <ActivityIndicator accessibilityLabel={t("Loading blocked people", "Chargement des personnes bloquées")} size="large" style={styles.loading} />;
  if (!blocked.data) return <LoadError message={t("Couldn't load the people you've blocked. Check your connection.", "Impossible de charger les personnes bloquées. Vérifiez votre connexion.")} onRetry={() => void blocked.refetch()} />;

  return (
    <FlatList
      data={blocked.data}
      keyExtractor={(item) => item.id}
      contentContainerStyle={padding}
      ListHeaderComponent={unblock.isError ? <ErrorText>{friendlyError(unblock.error)}</ErrorText> : undefined}
      ListEmptyComponent={<T muted>{t("You haven't blocked anyone.", "Vous n'avez bloqué personne.")}</T>}
      renderItem={({ item }) => (
        <View style={[styles.row, { borderBottomColor: theme.line }]}>
          <T variant="bodyBold" style={styles.name}>
            {item.displayName}
          </T>
          <Button label={t("Unblock", "Débloquer")} kind="secondary" onPress={() => unblock.mutate(item.id)} disabled={unblock.isPending} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { flex: 1 },
});
