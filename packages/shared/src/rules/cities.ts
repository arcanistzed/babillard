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
