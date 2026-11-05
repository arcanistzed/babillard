import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlatList, StyleSheet, View } from "react-native";
import { api } from "@/api";
import { useTheme } from "@/theme";
import { Button, T } from "@/ui";

export default function Blocked() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const blocked = useQuery({ queryKey: ["blocked"], queryFn: () => api.get<{ id: string; displayName: string }[]>("/safety/blocks") });
  const unblock = useMutation({
    mutationFn: (id: string) => api.delete(`/safety/blocks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["blocked"] }),
  });

  return (
    <FlatList
      data={blocked.data ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.body}
      ListEmptyComponent={blocked.isPending ? undefined : <T muted>You haven't blocked anyone.</T>}
      renderItem={({ item }) => (
        <View style={[styles.row, { borderBottomColor: theme.line }]}>
          <T variant="bodyBold" style={styles.name}>
            {item.displayName}
          </T>
          <Button label="Unblock" kind="secondary" onPress={() => unblock.mutate(item.id)} disabled={unblock.isPending} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  body: { padding: 20 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { flex: 1 },
});
