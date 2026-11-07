// Turns seed/*.json into idempotent SQL for `wrangler d1 execute`.
import { readFileSync, writeFileSync } from "node:fs";

interface SeedLocality { id: string; name: string; kind: string; parentId: string | null; region: string; country: string; countryCode: string; population: number; aliases: string[]; latitude: number; longitude: number }
interface SeedTopic { id: string; kind: string; title: string; blurb: string; fieldTags: string[]; openers: string[]; fr: { title: string; blurb: string; openers: string[] } }

const root = new URL("../seed/", import.meta.url);
const localities: SeedLocality[] = JSON.parse(readFileSync(new URL("localities.json", root), "utf8"));
const topics: SeedTopic[] = JSON.parse(readFileSync(new URL("topics.json", root), "utf8"));

// Places now folded into a metro area. Move anyone who picked one before removing it.
const merged: Record<string, string> = JSON.parse(readFileSync(new URL("merged-cities.json", root), "utf8"));

const quote = (value: string | null) => (value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`);
const now = Date.now();

const statements = [
  ...localities.map(
    (l) =>
      `INSERT INTO localities (id, slug, name, kind, parent_id, region, country, country_code, population, aliases, latitude, longitude) VALUES (${quote(l.id)}, ${quote(l.id)}, ${quote(l.name)}, ${quote(l.kind)}, ${quote(l.parentId)}, ${quote(l.region)}, ${quote(l.country)}, ${quote(l.countryCode)}, ${l.population}, ${quote(JSON.stringify(l.aliases))}, ${l.latitude}, ${l.longitude}) ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, parent_id=excluded.parent_id, region=excluded.region, country=excluded.country, country_code=excluded.country_code, population=excluded.population, aliases=excluded.aliases, latitude=excluded.latitude, longitude=excluded.longitude;`,
  ),
  ...Object.entries(merged).flatMap(([from, to]) => [
    `UPDATE users SET city_id = ${quote(to)} WHERE city_id = ${quote(from)};`,
    `DELETE FROM localities WHERE id = ${quote(from)};`,
  ]),
  ...topics.map(
    (t) =>
      `INSERT OR IGNORE INTO topics (id, kind, title, blurb, field_tags, openers, status, created_at) VALUES (${quote(t.id)}, ${quote(t.kind)}, ${quote(t.title)}, ${quote(t.blurb)}, ${quote(JSON.stringify(t.fieldTags))}, ${quote(JSON.stringify(t.openers))}, 'seeded', ${now});`,
  ),
  // Existing rows pick up new fields and translations. Topics people suggested are left alone.
  ...topics.map(
    (t) => `UPDATE topics SET field_tags = ${quote(JSON.stringify(t.fieldTags))}, fr = ${quote(JSON.stringify(t.fr))} WHERE id = ${quote(t.id)} AND status = 'seeded';`,
  ),
];

writeFileSync(new URL("seed.sql", root), `${statements.join("\n")}\n`);
console.log(`Wrote ${localities.length} localities and ${topics.length} topics to seed/seed.sql`);
