import { Ionicons } from "@expo/vector-icons";
import { campusForDomain, describeCity, nearestCity, searchCities, type Locality } from "@ideas-match/shared";
import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, View } from "react-native";
import { api } from "@/api";
import { useAuth } from "@/auth";
import { useTheme } from "@/theme";
import { Button, Chip, ChipRow, ErrorText, Field, T } from "@/ui";

const LOCATION_TIMEOUT_MS = 10_000;

/** Coarse and one-off. The result stays on the phone, which works out the nearest city itself. */
async function currentCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
  const position = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS)),
  ]);
  const known = position ?? (await Location.getLastKnownPositionAsync());
  return known?.coords ?? null;
}

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
  const { me } = useAuth();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  // A school email already says where someone studies, until they choose otherwise.
  const touched = useRef(false);
  const emailCampus = useMemo(() => {
    const id = campusForDomain(me?.institutionDomain);
    return id ? all?.find((item) => item.id === id) : undefined;
  }, [all, me?.institutionDomain]);

  useEffect(() => {
    if (touched.current || !emailCampus?.parentId) return;
    if (!cityId) onChange(emailCampus.parentId, emailCampus.id);
    else if (cityId === emailCampus.parentId && !campusId) onChange(cityId, emailCampus.id);
  }, [campusId, cityId, emailCampus, onChange]);

  function chooseCity(id: string) {
    touched.current = true;
    Keyboard.dismiss();
    onChange(id, emailCampus?.parentId === id ? emailCampus.id : null);
  }

  async function fillFromLocation() {
    if (!all) return;
    setLocating(true);
    setLocationError(null);
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) {
        setLocationError("Location is off. Search instead.");
        return;
      }
      const coords = await currentCoordinates();
      const city = coords ? nearestCity(all, coords.latitude, coords.longitude) : null;
      if (city) chooseCity(city.id);
      else setLocationError("Couldn't find your location. Search instead.");
    } catch {
      setLocationError("Couldn't find your location. Search instead.");
    } finally {
      setLocating(false);
    }
  }
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
              touched.current = true;
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
                <Chip key={campus.id} label={campus.name} selected={campusId === campus.id} onPress={() => {
                    touched.current = true;
                    onChange(selected.id, campusId === campus.id ? null : campus.id);
                  }} />
              ))}
            </ChipRow>
          </>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Field
        label="Find your city"
        value={query}
        onChangeText={setQuery}
        placeholder="City or town"
        autoCorrect={false}
        returnKeyType="search"
        trailing={
          locating ? (
            <ActivityIndicator accessibilityLabel="Finding your location" color={theme.ink} />
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel="Use my location" hitSlop={8} onPress={() => void fillFromLocation()} style={styles.locate}>
              <Ionicons name="locate" size={24} color={theme.ink} />
            </Pressable>
          )
        }
      />
      {locationError ? <ErrorText>{locationError}</ErrorText> : null}
      {query.trim() ? null : <T variant="heading">Major Canadian cities</T>}
      {results.map((city) => {
        const matchedSuburb = query.trim() ? city.aliases.find((alias) => alias.toLowerCase().startsWith(query.trim().toLowerCase())) : undefined;
        return (
          <Pressable
            key={city.id}
            accessibilityRole="button"
            accessibilityLabel={`${city.name}, ${describeCity(city)}`}
            onPress={() => chooseCity(city.id)}
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
  locate: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  selected: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 2, borderRadius: 12, paddingLeft: 14, paddingVertical: 8 },
  selectedText: { flex: 1, gap: 1 },
  result: { minHeight: 56, justifyContent: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
