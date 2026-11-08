// Fills a running local Worker with 30 people across two cities, then checks
// that the swipes produced a match and a group. Everything goes through the
// real API. Needs DEV_MODE=true, and migrations and seed data already applied.
//
//   pnpm --filter @babillard/api seed:dev
import { createPerson, type Client } from "./api-client.ts";

const BASE_URL = process.env.API_URL ?? "http://localhost:8787";

const FIRST_NAMES = ["Ada", "Bo", "Cleo", "Dev", "Esi", "Finn", "Gia", "Hari", "Ines", "Jun", "Kai", "Lena", "Milo", "Noor", "Oren", "Priya", "Quinn", "Rafa", "Sana", "Theo", "Uma", "Vik", "Wren", "Xia", "Yusuf", "Zoe", "Amir", "Bea", "Cato", "Dara"];
const ROLES = ["undergrad", "grad", "researcher", "other"];
const FIELDS = [["economics", "politics"], ["philosophy", "literature"], ["computer_science", "mathematics"], ["urbanism", "environment"], ["psychology", "sociology"]];
const LOOKING_FOR = [["learning", "friends"], ["research", "networking"], ["reading_group", "debate"], ["friends", "more_than_friends"], ["networking", "debate"]];
const CITIES = [
  { id: "boston", campuses: ["harvard", "mit", "boston-university", null], topics: ["walkable-cities", "behavioral-economics", "should-cities-abolish-single-family-zoning"] },
  { id: "toronto", campuses: ["u-of-t", "york-university", null], topics: ["great-books-reading-group", "machine-learning-research", "should-public-transit-be-free"] },
];
const STANCES = ["for", "against", "unsure"];

async function main() {
  const people: { client: Client; cityIndex: number; name: string; email: string }[] = [];

  for (let i = 0; i < 30; i += 1) {
    const cityIndex = i < 18 ? 0 : 1;
    const city = CITIES[cityIndex]!;
    const email = `seed-${String(i + 1).padStart(2, "0")}@example.test`;
    const client = await createPerson(BASE_URL, email, {
      displayName: FIRST_NAMES[i]!,
      cityId: city.id,
      campusId: city.campuses[i % city.campuses.length] ?? null,
      role: ROLES[i % ROLES.length]!,
      fields: FIELDS[i % FIELDS.length]!,
      lookingFor: LOOKING_FOR[i % LOOKING_FOR.length]!,
      bio: `Seeded person ${i + 1}, here to talk ideas.`,
    }).catch(async (error) => {
      // Already onboarded by an earlier run. Sign back in and carry on.
      if (error.status !== 409) throw error;
      const { Client: ClientClass } = await import("./api-client.ts");
      return new ClientClass(BASE_URL).signIn(email);
    });
    people.push({ client, cityIndex, name: FIRST_NAMES[i]!, email });
  }

  for (const [index, person] of people.entries()) {
    for (const topicId of CITIES[person.cityIndex]!.topics) {
      await person.client.post(`/deck/topics/${topicId}/swipe`, { direction: "right", stance: STANCES[index % STANCES.length] });
    }
  }

  const [first, second] = people;
  await first!.client.post(`/people/${second!.client.id}/swipe`, { direction: "right" });
  const match = await second!.client.post<{ matched: boolean; conversationId: string }>(`/people/${first!.client.id}/swipe`, { direction: "right" });

  const inbox = await first!.client.get<{ kind: string; title: string }[]>("/conversations");
  const groups = inbox.filter((item) => item.kind === "group");
  console.log(`Seeded ${people.length} people. ${first!.name} now has ${inbox.length} conversations, ${groups.length} of them groups.`);
  console.log(`Match between ${first!.name} and ${second!.name}: ${match.matched}`);
  if (!match.matched) throw new Error("Seed did not produce a match");
  if (groups.length === 0) throw new Error("Seed did not produce a group");
  console.log(`Sign in on a device as ${first!.email} or ${second!.email}. DEV_MODE shows the code on the check-your-inbox screen.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
