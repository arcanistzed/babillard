// Turns seed/*.json into idempotent SQL for `wrangler d1 execute`.
import { readFileSync, writeFileSync } from "node:fs";

interface SeedLocality { id: string; name: string; kind: string; parentId: string | null; region: string; country: string; countryCode: string; population: number; aliases: string[] }
interface SeedTopic { id: string; kind: string; title: string; blurb: string; fieldTags: string[]; openers: string[] }

const root = new URL("../seed/", import.meta.url);
const localities: SeedLocality[] = JSON.parse(readFileSync(new URL("localities.json", root), "utf8"));
const topics: SeedTopic[] = JSON.parse(readFileSync(new URL("topics.json", root), "utf8"));

const quote = (value: string | null) => (value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`);
const now = Date.now();

const statements = [
  ...localities.map(
    (l) =>
      `INSERT INTO localities (id, slug, name, kind, parent_id, region, country, country_code, population, aliases) VALUES (${quote(l.id)}, ${quote(l.id)}, ${quote(l.name)}, ${quote(l.kind)}, ${quote(l.parentId)}, ${quote(l.region)}, ${quote(l.country)}, ${quote(l.countryCode)}, ${l.population}, ${quote(JSON.stringify(l.aliases))}) ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, parent_id=excluded.parent_id, region=excluded.region, country=excluded.country, country_code=excluded.country_code, population=excluded.population, aliases=excluded.aliases;`,
  ),
  ...topics.map(
    (t) =>
      `INSERT OR IGNORE INTO topics (id, kind, title, blurb, field_tags, openers, status, created_at) VALUES (${quote(t.id)}, ${quote(t.kind)}, ${quote(t.title)}, ${quote(t.blurb)}, ${quote(JSON.stringify(t.fieldTags))}, ${quote(JSON.stringify(t.openers))}, 'seeded', ${now});`,
  ),
];

writeFileSync(new URL("seed.sql", root), `${statements.join("\n")}\n`);
console.log(`Wrote ${localities.length} localities and ${topics.length} topics to seed/seed.sql`);
