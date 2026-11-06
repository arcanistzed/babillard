import type { Locality } from "../api";

const CANADA = "CA";

/** Lower case with accents removed, so "montreal" finds "Montréal". */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function matchRank(city: Locality, tokens: string[]): number | null {
  const name = foldText(city.name);
  const aliases = city.aliases.map(foldText);
  const place = foldText(`${city.region} ${city.country}`);
  const haystack = `${name} ${aliases.join(" ")} ${place}`;
  if (!tokens.every((token) => haystack.includes(token))) return null;

  const first = tokens[0]!;
  if (name.startsWith(first)) return 0;
  if (aliases.some((alias) => alias.startsWith(first))) return 1;
  if (name.includes(first)) return 2;
  return 3;
}

/**
 * Finds cities by name, suburb, province, or country. Better matches come first,
 * then bigger cities. With nothing typed, it suggests major Canadian cities.
 */
export function searchCities(localities: Locality[], query: string, limit = 12): Locality[] {
  const cities = localities.filter((locality) => locality.kind === "city");
  const tokens = foldText(query).split(/[\s,]+/).filter(Boolean);

  if (tokens.length === 0) {
    return cities
      .filter((city) => city.countryCode === CANADA)
      .sort((a, b) => b.population - a.population)
      .slice(0, limit);
  }
  return cities
    .flatMap((city) => {
      const rank = matchRank(city, tokens);
      return rank === null ? [] : [{ city, rank }];
    })
    .sort((a, b) => a.rank - b.rank || b.city.population - a.city.population)
    .slice(0, limit)
    .map((entry) => entry.city);
}

export function describeCity(city: Locality): string {
  return [city.region, city.country].filter(Boolean).join(", ");
}

const EARTH_RADIUS_KM = 6371;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Runs on the phone, so someone's coordinates never need to reach the server. */
export function nearestCity(localities: Locality[], latitude: number, longitude: number): Locality | null {
  let nearest: Locality | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const locality of localities) {
    if (locality.kind !== "city") continue;
    const distance = distanceKm(latitude, longitude, locality.latitude, locality.longitude);
    if (distance < best) {
      best = distance;
      nearest = locality;
    }
  }
  return nearest;
}
