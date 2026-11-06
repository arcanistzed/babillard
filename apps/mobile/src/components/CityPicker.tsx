import { describeCity, searchCities, type Locality } from "@ideas-match/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { api } from "@/api";
import { useTheme } from "@/theme";
import { Button, Chip, ChipRow, ErrorText, Field, T } from "@/ui";

export function useLocalities() {
  return useQuery({ queryKey: ["localities"], queryFn: () => api.get<Locality[]>("/me/localities"), staleTime: Number.POSITIVE_INFINITY });
}

/** Search across the city list, with major Canadian cities suggested before anything is typed. */
export function CityPicker({
  cityId,
  campusId,
  onChange,
}: {
  cityId: string | null;
  campusId: string | null;
  onChange: (cityId: string | null, campusId: string | null) => void;
}) {
  const theme = useTheme();
  const localities = useLocalities();
  const [query, setQuery] = useState("");
  const all = localities.data;
  const results = useMemo(() => (all ? searchCities(all, query) : []), [all, query]);
  const selected = all?.find((item) => item.id === cityId);
  const campuses = all?.filter((item) => item.kind === "campus" && item.parentId === cityId) ?? [];

  if (localities.isError) {
    return (
      <View style={styles.block}>
        <ErrorText>Couldn't load cities. Check your connection.</ErrorText>
        <Button label="Try again" kind="secondary" onPress={() => void localities.refetch()} />
      </View>
    );
  }
  if (!all) return <ActivityIndicator accessibilityLabel="Loading cities" />;

  if (selected) {
    return (
      <View style={styles.block}>
        <View style={[styles.selected, { borderColor: theme.ink, backgroundColor: theme.surface }]}>
          <View style={styles.selectedText}>
            <T variant="heading">{selected.name}</T>
            <T variant="small" muted>
              {describeCity(selected)}
            </T>
            {selected.aliases.length > 0 ? (
              <T variant="small" muted>
                Includes {selected.aliases.slice(0, 4).join(", ")}
              </T>
            ) : null}
          </View>
          <Button
            label="Change"
            kind="quiet"
            onPress={() => {
              setQuery("");
              onChange(null, null);
            }}
          />
        </View>
        {campuses.length > 0 ? (
          <>
            <T variant="heading">Are you on a campus?</T>
            <ChipRow>
              {campuses.map((campus) => (
                <Chip key={campus.id} label={campus.name} selected={campusId === campus.id} onPress={() => onChange(selected.id, campusId === campus.id ? null : campus.id)} />
              ))}
            </ChipRow>
          </>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Field label="Find your city" value={query} onChangeText={setQuery} placeholder="Ottawa" autoCorrect={false} returnKeyType="search" />
      {query.trim() ? null : <T variant="heading">Major Canadian cities</T>}
      {results.map((city) => {
        const matchedSuburb = query.trim() ? city.aliases.find((alias) => alias.toLowerCase().startsWith(query.trim().toLowerCase())) : undefined;
        return (
          <Pressable
            key={city.id}
            accessibilityRole="button"
            accessibilityLabel={`${city.name}, ${describeCity(city)}`}
            onPress={() => onChange(city.id, null)}
            style={({ pressed }) => [styles.result, { borderBottomColor: theme.line, opacity: pressed ? 0.6 : 1 }]}
          >
            <T variant="bodyBold">{city.name}</T>
            <T variant="small" muted>
              {matchedSuburb ? `Includes ${matchedSuburb}. ` : ""}
              {describeCity(city)}
            </T>
          </Pressable>
        );
      })}
      {query.trim() && results.length === 0 ? <T muted>Not listed. Try the nearest big city.</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  selected: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 2, borderRadius: 12, paddingLeft: 14, paddingVertical: 8 },
  selectedText: { flex: 1, gap: 1 },
  result: { minHeight: 56, justifyContent: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
