import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ApiError, Client, createPerson, type PersonSeed } from "../scripts/api-client.ts";
import { canLinkInEmail, loginEmailContent } from "../src/lib/loginEmailContent.ts";
import { randomBytes } from "node:crypto";
import { generateDeviceKey, nearestCity, openMessage, sealMessage, searchCities, type Locality } from "@ideas-match/shared";

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "http://localhost:8799";
const PROD = "http://localhost:8798";
const DEV_DB = ".wrangler/e2e/dev";

let counter = 0;
async function person(cityId: string, overrides: Partial<PersonSeed> = {}): Promise<Client & { email: string }> {
  counter += 1;
  const email = `e2e-${counter}@example.test`;
  const client = await createPerson(BASE, email, { displayName: `Person ${counter}`, cityId, ...overrides });
  return Object.assign(client, { email });
}

async function status(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (error) {
    if (error instanceof ApiError) return error.status;
    throw error;
  }
}

interface SesRequest {
  method: string;
  path: string;
  authorization: string;
  amzDate: string;
  body: { FromEmailAddress: string; Destination: { ToAddresses: string[] }; Content: { Simple: { Subject: { Data: string }; Body: { Text: { Data: string }; Html: { Data: string } } } } };
}

function sesRequests(to: string): SesRequest[] {
  const file = readFileSync(join(apiDir, ".wrangler/e2e/ses.jsonl"), { encoding: "utf8", flag: "a+" });
  return file
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SesRequest)
    .filter((request) => request.body.Destination.ToAddresses.includes(to));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  let last: T;
  do {
    last = await read();
    if (done(last)) return last;
    await sleep(200);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

function pushLog(): { userIds: string[]; title: string; body: string; data: { screen: string; id: string } }[] {
  const log = readFileSync(join(apiDir, ".wrangler/e2e/dev.log"), "utf8");
  return [...log.matchAll(/\{"event":"push".*?\}\}/g)].map((match) => JSON.parse(match[0]));
}

async function sweep(): Promise<void> {
  const response = await fetch(`${BASE}/__scheduled?cron=*/5+*+*+*+*`);
  expect(response.status).toBe(200);
  await sleep(500);
}

/** A message only its sender can read, for sends the server should refuse before it looks at who can read it. */
function sealedAlone(sender: Client, conversationId: string) {
  return { envelope: sealMessage({ text: "refused", conversationId, senderId: sender.id, sender: sender.device, readers: [sender.device.publicKey], random: randomBytes }) };
}

/** What the report screen sends: the keys for the reported message and its neighbours. */
async function evidenceNear(reporter: Client, conversationId: string, messageId: string) {
  const nearby = await reporter.read(conversationId, `?around=${messageId}`);
  return nearby.filter((message) => message.contentKey).map((message) => ({ messageId: message.id, contentKey: message.contentKey }));
}

async function match(a: Client, b: Client, topicId: string): Promise<string> {
  await a.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
  await b.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
  await a.post(`/people/${b.id}/swipe`, { direction: "right" });
  const result = await b.post(`/people/${a.id}/swipe`, { direction: "right" });
  expect(result.matched).toBe(true);
  return result.conversationId;
}

function openSocket(client: Client, conversationId: string): Promise<{ socket: WebSocket; events: any[] }> {
  const url = `${BASE.replace("http", "ws")}/conversations/${conversationId}/ws`;
  const socket = new (WebSocket as any)(url, { headers: { authorization: `Bearer ${client.token}` } }) as WebSocket;
  const events: any[] = [];
  socket.addEventListener("message", (event) => events.push(JSON.parse(String(event.data))));
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve({ socket, events }));
    socket.addEventListener("error", () => reject(new Error("socket failed")));
  });
}

describe("sign-in", () => {
  it("rejects protected routes without a session", async () => {
    expect(await status(new Client(BASE).get("/me"))).toBe(401);
  });

  it("signs in with a code, once", async () => {
    const client = new Client(BASE);
    const { devCode } = await client.post("/auth/start", { email: "code@example.test" });
    expect(devCode).toMatch(/^\d{6}$/);
    expect((await client.post("/auth/verify", { email: "code@example.test", code: devCode })).token).toBeTruthy();
    expect(await status(client.post("/auth/verify", { email: "code@example.test", code: devCode }))).toBe(401);
  });

  it("signs in with an emailed link token, once", async () => {
    const client = new Client(BASE);
    const { devToken } = await client.post("/auth/start", { email: "link@example.test" });
    expect((await client.post("/auth/verify", { token: devToken })).token).toBeTruthy();
    expect(await status(client.post("/auth/verify", { token: devToken }))).toBe(401);
  });

  it("does not use up the token when a mail scanner fetches the link", async () => {
    const client = new Client(BASE);
    const { devToken } = await client.post("/auth/start", { email: "scanner@example.test" });
    const page = await fetch(`${BASE}/auth/link?token=${devToken}`);
    expect(page.status).toBe(200);
    expect((await client.post("/auth/verify", { token: devToken })).token).toBeTruthy();
  });

  it("locks a code after five wrong guesses", async () => {
    const client = new Client(BASE);
    const email = "guess@example.test";
    const { devCode } = await client.post("/auth/start", { email });
    const wrong = devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) expect(await status(client.post("/auth/verify", { email, code: wrong }))).toBe(401);
    expect(await status(client.post("/auth/verify", { email, code: devCode }))).toBe(401);
  });

  it("badges institution email without gating anyone else", async () => {
    const edu = await new Client(BASE).signIn("sam@cs.stanford.edu");
    const open = await new Client(BASE).signIn("sam@gmail.com");
    const canadian = await new Client(BASE).signIn("sam@uottawa.ca");
    expect((await canadian.get("/me")).verifiedInstitution).toBe(true);
    const eduMe = await edu.get("/me");
    expect(eduMe.verifiedInstitution).toBe(true);
    expect(eduMe.institutionDomain).toBe("cs.stanford.edu");
    expect((await open.get("/me")).verifiedInstitution).toBe(false);
  });

  it("logs out", async () => {
    const client = await new Client(BASE).signIn("logout@example.test");
    await client.post("/auth/logout");
    expect(await status(client.get("/me"))).toBe(401);
  });
});

describe("production settings", () => {
  it("never returns login secrets", async () => {
    const response = await fetch(`${PROD}/auth/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "prod@example.test" }),
    });
    const body = await response.json();
    expect(body).not.toHaveProperty("devCode");
    expect(body).not.toHaveProperty("devToken");
  });

  it("stops sending after three login emails in the window, without saying so", async () => {
    const send = () =>
      fetch(`${PROD}/auth/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "flood@example.test" }) });
    for (let i = 0; i < 5; i += 1) expect((await send()).status).toBe(200);
    expect(sesRequests("flood@example.test")).toHaveLength(3);
  });

  it("sends a correctly signed SES request with a working code and link", async () => {
    const email = "real-mail@example.test";
    const start = await fetch(`${PROD}/auth/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    expect(start.status).toBe(200);

    const [request] = sesRequests(email);
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/v2/email/outbound-emails");
    expect(request?.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAE2EFAKEKEY\/\d{8}\/ca-central-1\/ses\/aws4_request, SignedHeaders=\S+, Signature=[0-9a-f]{64}$/);
    expect(request?.amzDate).toMatch(/^\d{8}T\d{6}Z$/);
    expect(JSON.stringify(request)).not.toContain("e2e-fake-secret-value");
    expect(request?.body.FromEmailAddress).toBe("Ideas Match <login@example.test>");

    const text = request!.body.Content.Simple.Body.Text.Data;
    const code = /code is (\d{6})/.exec(text)?.[1];
    const link = /(http\S+\/auth\/link\?token=\S+)/.exec(text)?.[1];
    expect(code).toBeTruthy();
    expect(request!.body.Content.Simple.Subject.Data).toBe(`${code} is your Ideas Match code`);
    expect(request!.body.Content.Simple.Body.Html.Data).toContain(code);
    expect(link?.startsWith(PROD)).toBe(true);

    const landing = await fetch(link!);
    expect(await landing.text()).toContain("ideasmatch://auth/link?token=");

    const client = new Client(PROD);
    const session = await client.post("/auth/verify", { email, code });
    expect(session.me.email).toBe(email);
    expect(await status(client.post("/auth/verify", { token: new URL(link!).searchParams.get("token") }))).toBe(401);
  });

  it("reports a clear error when SES refuses, without leaking details", async () => {
    const response = await fetch(`${PROD}/auth/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ses-reject@example.test" }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "email_unavailable" });
    const log = await waitFor(
      async () => readFileSync(join(apiDir, ".wrangler/e2e/prod.log"), "utf8"),
      (text) => text.includes("SES returned 400 MessageRejected"),
      "SES failure in the log",
    );
    expect(log).not.toContain("e2e-fake-secret-value");
    expect(log).not.toMatch(/is your Ideas Match code/);
  });

  it("slows one network requesting codes for many different addresses", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const response = await fetch(`${PROD}/auth/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `limited-${i}@example.test` }) });
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
    expect(statuses.lastIndexOf(200)).toBeLessThan(statuses.indexOf(429));
    expect(sesRequests("limited-11@example.test")).toHaveLength(0);
  });

  it("closes admin pages when Access is not configured", async () => {
    expect((await fetch(`${PROD}/admin`)).status).toBe(403);
    expect((await fetch(`${PROD}/admin/reports`, { headers: { "cf-access-jwt-assertion": "forged" } })).status).toBe(403);
    expect((await fetch(`${PROD}/admin/topics`, { method: "POST" })).status).toBe(403);
    expect((await fetch(`${PROD}/admin/users`)).status).toBe(403);
    expect((await fetch(`${PROD}/admin/users/anyone/unban`, { method: "POST" })).status).toBe(403);
  });
});

describe("sign-in email content", () => {
  it("leaves out workers.dev links, which mail filters treat as phishing", () => {
    const email = loginEmailContent("123456", "https://ideas-match-api.ideas-match.workers.dev/auth/link?token=abc");
    expect(email.subject).toBe("123456 is your Ideas Match code");
    for (const body of [email.text, email.html]) {
      expect(body).toContain("123456");
      expect(body).not.toContain("workers.dev");
      expect(body).not.toContain("token=");
      expect(body).not.toContain("Both expire");
    }
  });

  it("only allows links on the API's own domain", () => {
    expect(canLinkInEmail("https://ideas-match-api.ideas-match.workers.dev/admin/reports")).toBe(false);
    expect(canLinkInEmail("https://api.example.org/admin/reports")).toBe(true);
  });

  it("includes the link on the API's own domain", () => {
    const email = loginEmailContent("123456", "https://api.example.org/auth/link?token=abc");
    expect(email.text).toContain("https://api.example.org/auth/link?token=abc");
    expect(email.html).toContain('href="https://api.example.org/auth/link?token=abc"');
    expect(email.text).toContain("Both expire");
  });
});

describe("city data", () => {
  const localities: Locality[] = JSON.parse(readFileSync(join(apiDir, "seed/localities.json"), "utf8"));
  const nearest = (latitude: number, longitude: number) => nearestCity(localities, latitude, longitude)?.name;

  it("puts suburbs in their metro area when using location", () => {
    expect(nearest(45.394, -75.85)).toBe("Ottawa"); // Aylmer
    expect(nearest(45.477, -75.701)).toBe("Ottawa"); // Gatineau
    expect(nearest(45.31, -75.91)).toBe("Ottawa"); // Kanata
    expect(nearest(43.59, -79.64)).toBe("Toronto"); // Mississauga
    expect(nearest(45.57, -73.69)).toBe("Montréal"); // Laval
    expect(nearest(45.52, -73.58)).toBe("Montréal"); // The Plateau
    expect(nearest(49.19, -122.85)).toBe("Vancouver"); // Surrey
  });

  it("finds a metro area by searching a suburb or borough", () => {
    for (const [query, city] of [["aylmer", "Ottawa"], ["gatineau", "Ottawa"], ["stittsville", "Ottawa"], ["mississauga", "Toronto"], ["ville-marie", "Montréal"], ["laval", "Montréal"]] as const) {
      expect(searchCities(localities, query)[0]?.name, query).toBe(city);
    }
  });

  it("keeps separate Canadian cities separate", () => {
    expect(nearest(43.25, -79.87)).toBe("Hamilton");
    expect(nearest(43.46, -80.52)).toBe("Waterloo");
    expect(nearest(43.55, -80.25)).toBe("Guelph");
  });

  it("has no merged place left as its own row, and every move points at a real city", () => {
    const merged: Record<string, string> = JSON.parse(readFileSync(join(apiDir, "seed/merged-cities.json"), "utf8"));
    const ids = new Set(localities.map((locality) => locality.id));
    for (const [from, to] of Object.entries(merged)) {
      expect(ids.has(from), from).toBe(false);
      expect(ids.has(to), to).toBe(true);
    }
    expect(ids.has("aylmer-10-ca")).toBe(false);
    // Hand-merged suburbs need a move recorded too, or their old rows stay behind in production.
    expect(merged["aylmer-10-ca"]).toBe("ottawa-08-ca");
    expect(merged["gatineau-10-ca"]).toBe("ottawa-08-ca");
  });
});

describe("onboarding", () => {
  const profile = { displayName: "Test", bio: "", role: "grad", fields: ["law"], lookingFor: ["learning"], cityId: "london", campusId: null };

  it("keeps people out of the deck until they finish", async () => {
    const client = await new Client(BASE).signIn("unfinished@example.test");
    expect(await status(client.get("/deck/topics"))).toBe(403);
  });

  it("turns away under-18s and stores nothing", async () => {
    const client = await new Client(BASE).signIn("minor@example.test");
    const year = new Date().getUTCFullYear() - 17;
    expect(await status(client.put("/me/onboarding", { acceptedTerms: true, ...profile, dob: `${year}-01-01` }))).toBe(403);
    const me = await client.get("/me");
    expect(me.onboarded).toBe(false);
    expect(me.profile).toBeNull();
  });

  it("rejects a campus from another city", async () => {
    const client = await new Client(BASE).signIn("wrongcampus@example.test");
    expect(await status(client.put("/me/onboarding", { ...profile, dob: "1999-01-01", campusId: "mit" }))).toBe(400);
  });

  it("does not let someone rewrite their date of birth afterwards", async () => {
    const client = await person("london");
    expect(await status(client.put("/me/onboarding", { ...profile, dob: "2000-01-01" }))).toBe(409);
  });

  it("serves all seeded localities", async () => {
    const client = await person("london");
    const localities = await client.get("/me/localities");
    const cities = localities.filter((l: any) => l.kind === "city");
    expect(cities.length).toBeGreaterThan(1500);
    const ottawa = cities.find((l: any) => l.name === "Ottawa" && l.countryCode === "CA");
    expect(ottawa.region).toBe("Ontario");
    expect(ottawa.aliases).toContain("Gatineau");
    expect(ottawa.latitude).toBeCloseTo(45.4, 0);
    expect(ottawa.longitude).toBeCloseTo(-75.7, 0);
    expect(localities.find((l: any) => l.id === "uottawa").parentId).toBe(ottawa.id);
    expect(cities.map((l: any) => l.population)).toEqual([...cities.map((l: any) => l.population)].sort((a: number, b: number) => b - a));
  });

  it("lets someone change their city later, and scopes people to the new one", async () => {
    const mover = await person("boston");
    const local = await person("toronto");
    const topicId = "urban-history";
    for (const client of [mover, local]) await client.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
    expect((await mover.get("/people")).map((card: any) => card.id)).not.toContain(local.id);

    const moved = await mover.put("/me/location", { cityId: "toronto", campusId: "u-of-t" });
    expect(moved.cityId).toBe("toronto");
    expect(moved.campusId).toBe("u-of-t");
    expect((await mover.get("/people")).map((card: any) => card.id)).toContain(local.id);

    expect(await status(mover.put("/me/location", { cityId: "toronto", campusId: "mit" }))).toBe(400);
    expect(await status(mover.put("/me/location", { cityId: "harvard", campusId: null }))).toBe(400);
    expect((await mover.get("/me")).cityId).toBe("toronto");

    const groupTopic = "game-theory-in-everyday-life";
    const carried = await person("boston");
    await carried.post(`/deck/topics/${groupTopic}/swipe`, { direction: "right" });
    const locals = await Promise.all(Array.from({ length: 3 }, () => person("toronto")));
    for (const client of locals) await client.post(`/deck/topics/${groupTopic}/swipe`, { direction: "right" });
    await carried.put("/me/location", { cityId: "toronto", campusId: null });
    const inbox = await waitFor(() => carried.get("/conversations"), (rows: any[]) => rows.some((row) => row.kind === "group"), "group after moving city");
    expect(inbox.find((row: any) => row.kind === "group").memberCount).toBe(4);

    const saver = await person("boston");
    const saved = await saver.put("/me/profile", { displayName: "Moved Together", bio: "", role: "other", fields: ["law"], lookingFor: ["friends"], cityId: "toronto", campusId: "u-of-t" });
    expect(saved.profile.displayName).toBe("Moved Together");
    expect(saved.cityId).toBe("toronto");
    expect(saved.campusId).toBe("u-of-t");
    expect(await status(saver.put("/me/profile", { displayName: "Half Saved", bio: "", role: "other", fields: ["law"], lookingFor: ["friends"], cityId: "not-a-city" }))).toBe(400);
    expect((await saver.get("/me")).profile.displayName).toBe("Moved Together");
    const profileOnly = await saver.put("/me/profile", { displayName: "Stayed Put", bio: "", role: "other", fields: ["law"], lookingFor: ["friends"] });
    expect(profileOnly.cityId).toBe("toronto");

    const noConsent = await new Client(BASE).signIn("no-consent@example.test");
    const onboarding = { displayName: "No Consent", bio: "", role: "other", fields: ["law"], lookingFor: ["friends"], dob: "1999-01-01", cityId: "toronto", campusId: null };
    expect(await status(noConsent.put("/me/onboarding", onboarding))).toBe(400);
    expect((await noConsent.put("/me/onboarding", { ...onboarding, acceptedTerms: true })).termsAccepted).toBe(true);

    const unfinished = await new Client(BASE).signIn("no-location@example.test");
    expect(await status(unfinished.put("/me/location", { cityId: "toronto", campusId: null }))).toBe(403);
  });
});

describe("topic deck", () => {
  it("serves twenty topics and favours the viewer's fields", async () => {
    const client = await person("london", { fields: ["physics"] });
    const cards = await client.get("/deck/topics");
    expect(cards).toHaveLength(20);
    const physics = cards.filter((card: any) => card.fieldTags.includes("physics")).length;
    expect(physics).toBeGreaterThan(5);
  });

  it("does not show a swiped topic again", async () => {
    const client = await person("london");
    const [first] = await client.get("/deck/topics");
    await client.post(`/deck/topics/${first.id}/swipe`, { direction: "left" });
    const next = await client.get("/deck/topics");
    expect(next.map((card: any) => card.id)).not.toContain(first.id);
  });

  it("counts nearby people, per city", async () => {
    const here = await person("san-francisco");
    const topicId = "beautiful-proofs";
    await here.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
    const neighbour = await person("san-francisco", { fields: ["mathematics"] });
    const elsewhere = await person("toronto", { fields: ["mathematics"] });
    const find = (cards: any[]) => cards.find((card) => card.id === topicId);
    expect(find(await neighbour.get("/deck/topics"))?.nearbyCount).toBe(1);
    expect(find(await elsewhere.get("/deck/topics"))?.nearbyCount ?? 0).toBe(0);
  });

  it("keeps the first swipe when one is retried", async () => {
    const a = await person("london");
    await a.post("/deck/topics/poetry/swipe", { direction: "left" });
    await a.post("/deck/topics/poetry/swipe", { direction: "right" });
    const b = await person("london");
    await b.post("/deck/topics/poetry/swipe", { direction: "right" });
    expect((await b.get("/people")).map((card: any) => card.id)).not.toContain(a.id);
  });

  it("404s an unknown topic", async () => {
    const client = await person("london");
    expect(await status(client.post("/deck/topics/nope/swipe", { direction: "right" }))).toBe(404);
  });
});

describe("people and matching", () => {
  it("only shows people in the same city who share a topic", async () => {
    const viewer = await person("new-york");
    const shared = await person("new-york");
    const noTopic = await person("new-york");
    const otherCity = await person("london");
    const topicId = "film-as-an-art-form";
    for (const client of [viewer, shared, otherCity]) await client.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
    await noTopic.post("/deck/topics/poetry/swipe", { direction: "right" });

    const ids = (await viewer.get("/people")).map((card: any) => card.id);
    expect(ids).toContain(shared.id);
    expect(ids).not.toContain(noTopic.id);
    expect(ids).not.toContain(otherCity.id);
  });

  it("does not leak email or date of birth on a card", async () => {
    const viewer = await person("new-york");
    const other = await person("new-york", { displayName: "Private" });
    for (const client of [viewer, other]) await client.post("/deck/topics/music-theory-and-listening/swipe", { direction: "right" });
    const card = (await viewer.get("/people")).find((entry: any) => entry.id === other.id);
    expect(JSON.stringify(card)).not.toContain("@example.test");
    expect(card).not.toHaveProperty("dob");
    expect(card).not.toHaveProperty("email");
  });

  it("shows more-than-friends only when both people set it", async () => {
    const open = await person("new-york", { lookingFor: ["friends", "more_than_friends"] });
    const alsoOpen = await person("new-york", { lookingFor: ["more_than_friends"] });
    const notLooking = await person("new-york", { lookingFor: ["friends"] });
    const topicId = "photography-and-visual-culture";
    for (const client of [open, alsoOpen, notLooking]) await client.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });

    const seenBy = async (viewer: Client) => (await viewer.get("/people")).find((card: any) => card.id === open.id).lookingFor;
    expect(await seenBy(alsoOpen)).toContain("more_than_friends");
    expect(await seenBy(notLooking)).not.toContain("more_than_friends");
    expect(await seenBy(notLooking)).toContain("friends");
  });

  it("refuses a swipe on someone with no shared topic", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    expect(await status(a.post(`/people/${b.id}/swipe`, { direction: "right" }))).toBe(409);
  });

  it("makes no match on a one-sided or declined swipe", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const topicId = "contemporary-art";
    for (const client of [a, b]) await client.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
    expect((await a.post(`/people/${b.id}/swipe`, { direction: "right" })).matched).toBe(false);
    expect((await b.post(`/people/${a.id}/swipe`, { direction: "left" })).matched).toBe(false);
    expect(await a.get("/conversations")).toEqual([]);
  });

  it("opens a chat with a topic opener and pushes both people on a mutual swipe", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "literary-theory");

    const messages = await a.get(`/conversations/${conversationId}/messages`);
    expect(messages[0].kind).toBe("system");
    expect(messages[0].body).toMatch(/^You both want to dig into Literary theory\. /);

    const detail = await b.get(`/conversations/${conversationId}`);
    expect(detail.suggestedOpeners.length).toBeGreaterThan(0);
    expect(detail.expiresAt).toBeGreaterThan(Date.now() - 10_000);

    const pushes = await waitFor(
      async () => pushLog().filter((push) => push.data.id === conversationId),
      (rows) => rows.length > 0,
      "match push",
    );
    expect(pushes[0]?.userIds.sort()).toEqual([a.id, b.id].sort());
  });

  it("creates one match when both people swipe at the same moment", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const topicId = "rhetoric-and-persuasion";
    for (const client of [a, b]) await client.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
    const [left, right] = await Promise.all([a.post(`/people/${b.id}/swipe`, { direction: "right" }), b.post(`/people/${a.id}/swipe`, { direction: "right" })]);
    const conversationId = left.conversationId ?? right.conversationId;
    expect(conversationId).toBeTruthy();
    const systemMessages = (await a.get(`/conversations/${conversationId}/messages`)).filter((m: any) => m.kind === "system");
    expect(systemMessages).toHaveLength(1);
    expect((await a.get("/conversations")).filter((c: any) => c.kind === "direct")).toHaveLength(1);
  });
});

describe("chat", () => {
  it("delivers over WebSocket in both directions, without pushing someone who is connected", async () => {
    const a = await person("new-york", { displayName: "Sender" });
    const b = await person("new-york");
    const conversationId = await match(a, b, "sociolinguistics");
    const [socketA, socketB] = await Promise.all([openSocket(a, conversationId), openSocket(b, conversationId)]);

    const received = (events: any[], from: Client, reader: Client, text: string) =>
      events.some((e) => e.message?.envelope && openMessage({ envelope: e.message.envelope, conversationId, senderId: from.id, me: reader.device })?.text === text);
    socketA.socket.send(JSON.stringify({ type: "send", envelope: await a.seal(conversationId, "hello from a"), clientId: "c1" }));
    await waitFor(async () => socketB.events, (events) => received(events, a, b, "hello from a"), "b receiving");
    socketB.socket.send(JSON.stringify({ type: "send", envelope: await b.seal(conversationId, "hello from b") }));
    await waitFor(async () => socketA.events, (events) => received(events, b, a, "hello from b"), "a receiving");

    await sleep(300);
    expect(pushLog().filter((push) => push.title === "Sender" && push.data.id === conversationId)).toHaveLength(0);
    socketA.socket.close();
    socketB.socket.close();
  });

  it("never gives the server or push services the text of a message", async () => {
    const a = await person("new-york", { displayName: "Secret Keeper" });
    const b = await person("new-york");
    const conversationId = await match(a, b, "sociolinguistics");
    await a.say(conversationId, "my private words");

    const raw = await b.get(`/conversations/${conversationId}/messages`);
    const text = raw.find((message: any) => message.kind === "text");
    expect(text.body).toBe("");
    expect(JSON.stringify(raw)).not.toContain("my private words");
    expect(JSON.stringify(await b.get("/conversations"))).not.toContain("my private words");
    const pushed = await waitFor(async () => pushLog().filter((push) => push.title === "Secret Keeper"), (rows) => rows.length > 0, "the push");
    expect(pushed[0]!.body).toBe("New message");
    expect((await b.read(conversationId)).some((message) => message.body === "my private words")).toBe(true);
  });

  it("refuses plain text, and a message some devices couldn't read", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "sociolinguistics");
    expect(await status(a.post(`/conversations/${conversationId}/messages`, { body: "plain text" }))).toBe(400);

    const sealedEarlier = await a.seal(conversationId, "for the old list");
    const secondPhone = generateDeviceKey(randomBytes);
    await b.post("/me/device-key", { publicKey: secondPhone.publicKey });
    expect(await status(a.post(`/conversations/${conversationId}/messages`, { envelope: sealedEarlier }))).toBe(409);

    await a.say(conversationId, "for both phones");
    const opened = (await b.get(`/conversations/${conversationId}/messages`)).filter((message: any) => message.envelope).map((message: any) => openMessage({ envelope: message.envelope, conversationId, senderId: a.id, me: secondPhone })?.text);
    expect(opened).toEqual(["for both phones"]);

    const stranger = await person("new-york");
    expect(await status(stranger.post("/me/device-key", { publicKey: secondPhone.publicKey }))).toBe(409);
    const fromUnknownDevice = sealMessage({ text: "spoofed", conversationId, senderId: a.id, sender: generateDeviceKey(randomBytes), readers: [a.device.publicKey, b.device.publicKey, secondPhone.publicKey], random: randomBytes });
    expect(await status(a.post(`/conversations/${conversationId}/messages`, { envelope: fromUnknownDevice }))).toBe(409);
  });

  it("can't show a new phone older messages, and lets it read new ones", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "sociolinguistics");
    await a.say(conversationId, "before the new phone");
    const newPhone = await new Client(BASE).signIn(b.email);
    await a.say(conversationId, "after the new phone");
    const seen = await newPhone.read(conversationId);
    expect(seen.find((message) => message.envelope && message.unreadable)).toBeTruthy();
    expect(seen.some((message) => message.body === "before the new phone")).toBe(false);
    expect(seen.some((message) => message.body === "after the new phone")).toBe(true);
  });

  it("retires the oldest key after five phones, so its owner stops receiving there", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "sociolinguistics");
    const phones = Array.from({ length: 6 }, () => generateDeviceKey(randomBytes));
    for (const phone of phones) {
      await b.post("/me/device-key", { publicKey: phone.publicKey });
      await sleep(5);
    }
    const member = (await a.get(`/conversations/${conversationId}`)).members.find((row: any) => row.id === b.id);
    expect(member.deviceKeys).toHaveLength(5);
    expect(member.retiredDeviceKeys).toHaveLength(2);
    expect(member.deviceKeys).toContain(phones[5]!.publicKey);
  });

  it("does not store a retried message twice", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "language-learning");
    await a.say(conversationId, "once", "retry-1");
    await a.say(conversationId, "once", "retry-1");
    const texts = (await b.get(`/conversations/${conversationId}/messages`)).filter((m: any) => m.kind === "text");
    expect(texts).toHaveLength(1);
  });

  it("pushes someone offline and tracks their unread count", async () => {
    const a = await person("new-york", { displayName: "Offline Sender" });
    const b = await person("new-york");
    const conversationId = await match(a, b, "endangered-languages");
    await a.say(conversationId, "are you there");

    const pushes = await waitFor(
      async () => pushLog().filter((push) => push.title === "Offline Sender"),
      (rows) => rows.length > 0,
      "offline push",
    );
    expect(pushes[0]?.userIds).toEqual([b.id]);

    const item = (await b.get("/conversations")).find((c: any) => c.id === conversationId);
    expect(item.unreadCount).toBe(1);
    expect(item.lastMessagePreview).toBeNull();
    expect(openMessage({ envelope: item.lastMessageEnvelope, conversationId, senderId: a.id, me: b.device })?.text).toBe("are you there");
    expect(item.expiresAt).toBeNull();

    await b.post(`/conversations/${conversationId}/read`);
    expect((await b.get("/conversations")).find((c: any) => c.id === conversationId).unreadCount).toBe(0);
  });

  it("keeps strangers out over HTTP and WebSocket", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const stranger = await person("new-york");
    const conversationId = await match(a, b, "language-and-ai");
    expect(await status(stranger.get(`/conversations/${conversationId}`))).toBe(404);
    expect(await status(stranger.get(`/conversations/${conversationId}/messages`))).toBe(404);
    expect(await status(stranger.post(`/conversations/${conversationId}/messages`, sealedAlone(stranger, conversationId)))).toBe(403);
    await expect(openSocket(stranger, conversationId)).rejects.toThrow();
  });

  it("pages back through history", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "translation-and-world-literature");
    for (let i = 0; i < 3; i += 1) await a.say(conversationId, `m${i}`);
    const all = await a.get(`/conversations/${conversationId}/messages`);
    const older = await a.get(`/conversations/${conversationId}/messages?before=${all[all.length - 1].seq}`);
    expect(older.length).toBe(all.length - 1);
  });
});

describe("automatic groups", () => {
  it("forms exactly one group of four from four simultaneous swipes", async () => {
    const people = await Promise.all(Array.from({ length: 4 }, () => person("toronto")));
    const topicId = "contemporary-fiction";
    const results = await Promise.all(people.map((client) => client.post(`/deck/topics/${topicId}/swipe`, { direction: "right" })));
    const ids = new Set(results.map((result) => result.groupConversationId).filter(Boolean));
    expect(ids.size).toBe(1);

    const groupId = [...ids][0];
    const detail = await people[0]!.get(`/conversations/${groupId}`);
    expect(detail.kind).toBe("group");
    expect(detail.members).toHaveLength(4);
    expect(detail.title).toBe("Contemporary fiction");

    const messages = await people[1]!.get(`/conversations/${groupId}/messages`);
    expect(messages[0].body).toContain("A group on Contemporary fiction just opened in Toronto");

    const pushes = await waitFor(async () => pushLog().filter((push) => push.data.id === groupId), (rows) => rows.length > 0, "group push");
    expect(pushes[0]?.userIds.sort()).toEqual(people.map((client) => client.id).sort());
  });

  it("puts simultaneous swipers in one group, with nobody lost or split off", async () => {
    const topicIds = ["clinical-psychology-and-therapy-research", "history-of-science", "medieval-history", "ethics-and-moral-philosophy", "cognitive-psychology", "public-health"];
    for (const topicId of topicIds) {
      const people = await Promise.all(Array.from({ length: 8 }, () => person("boston")));
      const results = await Promise.all(people.map((client) => client.post(`/deck/topics/${topicId}/swipe`, { direction: "right" })));
      const groupIds = new Set(results.map((result) => result.groupConversationId).filter(Boolean));
      expect(groupIds.size, topicId).toBe(1);
      const detail = await people[0]!.get(`/conversations/${[...groupIds][0]}`);
      expect(detail.members.map((member: any) => member.id).sort(), topicId).toEqual(people.map((client) => client.id).sort());
    }
  });

  it("waits at three, adds latecomers to eight, then starts a new list", async () => {
    const topicId = "the-nineteenth-century-novel";
    const people = [];
    for (let i = 0; i < 12; i += 1) people.push(await person("toronto"));

    const results = [];
    for (const client of people) results.push(await client.post(`/deck/topics/${topicId}/swipe`, { direction: "right" }));

    expect(results.slice(0, 3).every((result) => result.groupConversationId === null)).toBe(true);
    const firstGroup = results[3].groupConversationId;
    expect(firstGroup).toBeTruthy();
    for (const result of results.slice(4, 8)) expect(result.groupConversationId).toBe(firstGroup);

    expect((await people[0]!.get(`/conversations/${firstGroup}`)).members).toHaveLength(8);
    expect(results.slice(8, 11).every((result) => result.groupConversationId === null)).toBe(true);

    const secondGroup = results[11].groupConversationId;
    expect(secondGroup).toBeTruthy();
    expect(secondGroup).not.toBe(firstGroup);
    expect((await people[8]!.get(`/conversations/${secondGroup}`)).members).toHaveLength(4);
  });

  it("keeps cities apart", async () => {
    const topicId = "science-fiction-as-philosophy";
    const toronto = await Promise.all(Array.from({ length: 2 }, () => person("toronto")));
    const london = await Promise.all(Array.from({ length: 2 }, () => person("london")));
    const results = [];
    for (const client of [...toronto, ...london]) results.push(await client.post(`/deck/topics/${topicId}/swipe`, { direction: "right" }));
    expect(results.every((result) => result.groupConversationId === null)).toBe(true);
  });

  it("never groups people with a block between them", async () => {
    const topicId = "existentialism";
    const [a, b, c, d, e] = await Promise.all(Array.from({ length: 5 }, () => person("toronto")));
    await a!.post(`/safety/blocks/${b!.id}`);
    const swipe = (client: Client) => client.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
    await swipe(a!);
    await swipe(b!);
    await swipe(c!);
    expect((await swipe(d!)).groupConversationId).toBeNull();
    const formed = (await swipe(e!)).groupConversationId;
    expect(formed).toBeTruthy();
    const ids = (await e!.get(`/conversations/${formed}`)).members.map((member: any) => member.id);
    expect(ids).toHaveLength(4);
    expect(ids.includes(a!.id) && ids.includes(b!.id)).toBe(false);
  });

  it("does not add someone to an open group with a person they blocked", async () => {
    const topicId = "ancient-philosophy";
    const members = await Promise.all(Array.from({ length: 4 }, () => person("toronto")));
    for (const client of members) await client.post(`/deck/topics/${topicId}/swipe`, { direction: "right" });
    const latecomer = await person("toronto");
    await latecomer.post(`/safety/blocks/${members[0]!.id}`);
    expect((await latecomer.post(`/deck/topics/${topicId}/swipe`, { direction: "right" })).groupConversationId).toBeNull();
  });

  it("shows a question group its spread of stances, and no individual's", async () => {
    const topicId = "should-public-servants-be-allowed-to-strike";
    const stances = ["for", "for", "against", "unsure"];
    const people = await Promise.all(stances.map(() => person("london")));
    let groupId: string | null = null;
    for (const [index, client] of people.entries()) {
      const result = await client.post(`/deck/topics/${topicId}/swipe`, { direction: "right", stance: stances[index] });
      groupId ??= result.groupConversationId;
    }
    const detail = await people[0]!.get(`/conversations/${groupId}`);
    expect(detail.stanceSpread).toEqual({ for: 2, against: 1, unsure: 1 });
    expect(JSON.stringify(detail.members)).not.toContain("against");
  });

  it("lets someone leave a group", async () => {
    const people = await Promise.all(Array.from({ length: 4 }, () => person("london")));
    let groupId: string | null = null;
    for (const client of people) groupId = (await client.post("/deck/topics/oral-history-and-memory/swipe", { direction: "right" })).groupConversationId ?? groupId;
    await people[0]!.post(`/conversations/${groupId}/leave`);
    expect(await status(people[0]!.get(`/conversations/${groupId}`))).toBe(404);
    const detail = await people[1]!.get(`/conversations/${groupId}`);
    expect(detail.members).toHaveLength(3);
    expect(await status(people[0]!.post(`/conversations/${groupId!}/messages`, sealedAlone(people[0]!, groupId!)))).toBe(403);
  });
});

describe("meetups", () => {
  const proposal = (overrides = {}) => ({ startsAt: Date.now() + 60 * 60 * 1000, endsAt: Date.now() + 2 * 60 * 60 * 1000, venueKind: "cafe", venueNote: "Blue Door, Main St", ...overrides });

  it("confirms a direct-chat meetup when both say yes", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "walkable-cities");
    const meetup = await a.post(`/meetups?conversationId=${conversationId}`, proposal());
    expect(meetup.state).toBe("proposed");
    expect(meetup.myResponse).toBe("yes");

    const messages = await b.get(`/conversations/${conversationId}/messages`);
    expect(messages[messages.length - 1].kind).toBe("meetup");
    expect(messages[messages.length - 1].meetupId).toBe(meetup.id);
    expect(messages[messages.length - 1].body).toBe(`Person ${counter - 1} proposed a meetup at Blue Door, Main St.`);

    expect((await b.post(`/meetups/${meetup.id}/respond`, { response: "yes" })).state).toBe("confirmed");
    const item = (await a.get("/conversations")).find((c: any) => c.id === conversationId);
    expect(item.nextMeetupAt).toBe(meetup.startsAt);
  });

  it("needs three yeses in a group", async () => {
    const people = await Promise.all(Array.from({ length: 5 }, () => person("london")));
    let groupId: string | null = null;
    for (const client of people) groupId = (await client.post("/deck/topics/third-places-and-community-spaces/swipe", { direction: "right" })).groupConversationId ?? groupId;
    const meetup = await people[0]!.post(`/meetups?conversationId=${groupId}`, proposal());
    expect(meetup.requiredYes).toBe(3);
    expect((await people[1]!.post(`/meetups/${meetup.id}/respond`, { response: "no" })).state).toBe("proposed");
    expect((await people[2]!.post(`/meetups/${meetup.id}/respond`, { response: "yes" })).state).toBe("proposed");
    expect((await people[3]!.post(`/meetups/${meetup.id}/respond`, { response: "yes" })).state).toBe("confirmed");
  });

  it("keeps non-members out and rejects bad proposals", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const stranger = await person("new-york");
    const conversationId = await match(a, b, "urban-planning");
    const meetup = await a.post(`/meetups?conversationId=${conversationId}`, proposal());
    expect(await status(stranger.get(`/meetups/${meetup.id}`))).toBe(404);
    expect(await status(stranger.post(`/meetups/${meetup.id}/respond`, { response: "yes" }))).toBe(404);
    expect(await status(stranger.post(`/meetups?conversationId=${conversationId}`, proposal()))).toBe(404);
    expect(await status(a.post(`/meetups?conversationId=${conversationId}`, proposal({ startsAt: Date.now() - 3_600_000 })))).toBe(400);
    expect(await status(a.post(`/meetups?conversationId=${conversationId}`, proposal({ endsAt: Date.now() - 1 })))).toBe(400);
  });

  it("lets only the proposer cancel", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "journalism-and-the-news");
    const meetup = await a.post(`/meetups?conversationId=${conversationId}`, proposal());
    expect(await status(b.post(`/meetups/${meetup.id}/cancel`))).toBe(403);
    expect((await a.post(`/meetups/${meetup.id}/cancel`)).state).toBe("cancelled");
    expect(await status(b.post(`/meetups/${meetup.id}/respond`, { response: "yes" }))).toBe(409);
  });

  it("serves a share page and calendar file with no names, and escapes the venue", async () => {
    const a = await person("new-york", { displayName: "Hidden Name" });
    const b = await person("new-york");
    const conversationId = await match(a, b, "sleep-science");
    const meetup = await a.post(`/meetups?conversationId=${conversationId}`, proposal({ venueNote: "<script>alert(1)</script>, Room; 2" }));

    const page = await (await fetch(meetup.shareUrl)).text();
    expect(page).not.toContain("<script>alert(1)");
    expect(page).toContain("&lt;script&gt;");
    expect(page).not.toContain("Hidden Name");

    const ics = await fetch(`${meetup.shareUrl}.ics`);
    expect(ics.headers.get("content-type")).toContain("text/calendar");
    const text = await ics.text();
    expect(text).toContain("BEGIN:VEVENT");
    expect(text).toContain("Room\; 2");
    expect((await fetch(`${BASE}/m/not-a-real-token`)).status).toBe(404);
  });

  it("reminds before, asks did-you-meet after, and records the answer", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "philosophy-of-sport-and-play");
    const now = Date.now();
    const meetup = await a.post(`/meetups?conversationId=${conversationId}`, proposal({ startsAt: now + 3000, endsAt: now + 4000 }));
    await b.post(`/meetups/${meetup.id}/respond`, { response: "yes" });
    expect(await status(a.post(`/meetups/${meetup.id}/did-meet`, { didMeet: true }))).toBe(409);

    await sweep();
    const reminders = await waitFor(
      async () => pushLog().filter((push) => push.title === "Your meetup is coming up" && push.data.id === meetup.id),
      (rows) => rows.length > 0,
      "reminder",
    );
    expect(reminders[0]?.userIds.sort()).toEqual([a.id, b.id].sort());
    await sweep();
    expect(pushLog().filter((push) => push.title === "Your meetup is coming up" && push.data.id === meetup.id)).toHaveLength(1);

    await sleep(4800);
    await sweep();
    await waitFor(
      async () => pushLog().filter((push) => push.title === "Did you meet?" && push.data.id === meetup.id),
      (rows) => rows.length > 0,
      "check-in",
    );
    const done = await a.get(`/meetups/${meetup.id}`);
    expect(done.state).toBe("done");
    expect(done.checkinOpen).toBe(true);
    expect((await a.post(`/meetups/${meetup.id}/did-meet`, { didMeet: true })).myDidMeet).toBe(true);
  });

  it("cancels a proposal nobody confirmed before it started", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "design-and-how-things-work");
    const now = Date.now();
    const meetup = await a.post(`/meetups?conversationId=${conversationId}`, proposal({ startsAt: now + 200, endsAt: now + 400 }));
    await sleep(400);
    await sweep();
    await waitFor(() => a.get(`/meetups/${meetup.id}`), (row: any) => row.state === "cancelled", "stale proposal");
  });
});

describe("silent matches", () => {
  it("nudges once, then expires and hides the chat", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "ecology-and-biodiversity");

    await sleep(2300);
    await sweep();
    await waitFor(
      async () => pushLog().filter((push) => push.title === "Your match is about to expire" && push.data.id === conversationId),
      (rows) => rows.length > 0,
      "nudge",
    );
    await sweep();
    expect(pushLog().filter((push) => push.title === "Your match is about to expire" && push.data.id === conversationId)).toHaveLength(1);
    const messages = await a.get(`/conversations/${conversationId}/messages`);
    expect(messages[messages.length - 1].body).toMatch(/^Still curious\?/);

    await sleep(2000);
    await sweep();
    await waitFor(() => a.get("/conversations"), (rows: any[]) => !rows.some((row) => row.id === conversationId), "expiry");
    expect(await status(a.post(`/conversations/${conversationId}/messages`, sealedAlone(a, conversationId)))).toBe(403);
    expect(await status(a.get(`/conversations/${conversationId}`))).toBe(410);
  });

  it("leaves a match alone once someone has written", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "animal-cognition");
    await a.say(conversationId, "hi");
    await sleep(4300);
    await sweep();
    await sleep(500);
    expect((await a.get("/conversations")).map((row: any) => row.id)).toContain(conversationId);
  });
});

describe("safety", () => {
  it("block hides people from each other's cards and ends their direct chat", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "neuroscience");
    await a.post(`/safety/blocks/${b.id}`);
    expect((await a.get("/conversations")).map((row: any) => row.id)).not.toContain(conversationId);
    expect((await b.get("/conversations")).map((row: any) => row.id)).not.toContain(conversationId);
    expect(await status(b.post(`/conversations/${conversationId}/messages`, sealedAlone(b, conversationId)))).toBe(403);

    const c = await person("new-york");
    const d = await person("new-york");
    for (const client of [c, d]) await client.post("/deck/topics/genetics-and-crispr/swipe", { direction: "right" });
    expect((await c.get("/people")).map((card: any) => card.id)).toContain(d.id);
    await c.post(`/safety/blocks/${d.id}`);
    expect((await c.get("/people")).map((card: any) => card.id)).not.toContain(d.id);
    expect((await d.get("/people")).map((card: any) => card.id)).not.toContain(c.id);
    expect((await c.get("/safety/blocks")).map((row: any) => row.id)).toEqual([d.id]);
    expect(await status(d.post(`/people/${c.id}/swipe`, { direction: "right" }))).toBe(404);
  });

  it("hides a blocked person's messages from the blocker in a shared group", async () => {
    const people = await Promise.all(Array.from({ length: 4 }, () => person("san-francisco", { displayName: "Group Person" })));
    let groupId: string | null = null;
    for (const client of people) groupId = (await client.post("/deck/topics/open-source-communities/swipe", { direction: "right" })).groupConversationId ?? groupId;
    const [a, b, c] = people;
    await a!.post(`/safety/blocks/${b!.id}`);
    await b!.say(groupId!, "visible to some");

    expect((await a!.read(groupId!)).some((m: any) => m.body === "visible to some")).toBe(false);
    expect((await c!.read(groupId!)).some((m: any) => m.body === "visible to some")).toBe(true);
    expect((await a!.get("/conversations")).find((row: any) => row.id === groupId).unreadCount).toBe(0);
  });

  it("carries a report through the admin queue to a ban that ends the session", async () => {
    const reporter = await person("new-york");
    const target = await person("new-york", { displayName: "Reported Person" });
    const conversationId = await match(reporter, target, "microbiome-research");
    const message = await target.say(conversationId, "<b>rude message</b>");
    await reporter.post("/safety/reports", { targetUserId: target.id, conversationId, messageId: message.id, reason: "harassment", note: "Please look", evidence: await evidenceNear(reporter, conversationId, message.id) });

    const queue = await (await fetch(`${BASE}/admin/reports`)).text();
    expect(queue).toContain("Reported Person");
    expect(queue).toContain("&lt;b&gt;rude message&lt;/b&gt;");
    expect(queue).not.toContain("<b>rude message</b>");

    const reportId = /Reported Person[^]*?\/admin\/reports\/([0-9a-f-]+)"/.exec(queue)?.[1];
    expect(reportId).toBeTruthy();
    const ban = await adminPost(`/admin/reports/${reportId}`, { action: "banned", confirm: "yes" });
    expect(ban.status).toBe(302);
    expect(await status(target.get("/me"))).toBe(401);

    expect(await status(new Client(BASE).signIn(target.email))).toBe(403);
  });

  it("rejects a cross-site admin form post", async () => {
    const response = await fetch(`${BASE}/admin/topics/poetry`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
      body: new URLSearchParams({ action: "rejected" }),
    });
    expect(response.status).toBe(403);
  });
});

async function adminPost(path: string, fields: Record<string, string>) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
    body: new URLSearchParams(fields),
  });
}

const adminPage = async (path: string) => (await fetch(`${BASE}${path}`)).text();

/** The id of the open report about this person, read from the page the way a moderator would see it. */
async function openReportId(name: string): Promise<string> {
  const queue = await adminPage("/admin/reports");
  const article = queue.split("<article>").find((part) => part.includes(name));
  const id = article && /action="\/admin\/reports\/([0-9a-f-]+)"/.exec(article)?.[1];
  if (!id) throw new Error(`No open report about ${name}`);
  return id;
}

describe("moderation", () => {
  it("alerts the admin about a report, flags urgent ones, and keeps private details out of the email", async () => {
    const before = sesRequests("admin@example.test").length;
    const reporter = await person("toronto");
    const target = await person("toronto", { displayName: "Secret Name" });
    await reporter.post("/safety/reports", { targetUserId: target.id, reason: "safety", note: "private note text" });
    const alerts = await waitFor(async () => sesRequests("admin@example.test"), (rows) => rows.length > before, "report alert");
    const alert = alerts[alerts.length - 1]!;
    expect(alert.body.Content.Simple.Subject.Data).toBe("[Urgent] New Ideas Match report: Feels unsafe");
    const content = JSON.stringify(alert.body.Content);
    expect(content).toContain("/admin/reports");
    expect(content).not.toContain("Secret Name");
    expect(content).not.toContain("private note text");
    await adminPost(`/admin/reports/${await openReportId("Secret Name")}`, { action: "resolved" });
  });

  it("does not mark ordinary reports urgent", async () => {
    const before = sesRequests("admin@example.test").length;
    const reporter = await person("toronto");
    const target = await person("toronto", { displayName: "Spammy Person" });
    await reporter.post("/safety/reports", { targetUserId: target.id, reason: "spam" });
    const alerts = await waitFor(async () => sesRequests("admin@example.test"), (rows) => rows.length > before, "report alert");
    expect(alerts[alerts.length - 1]!.body.Content.Simple.Subject.Data).toBe("New Ideas Match report: Spam");
    await adminPost(`/admin/reports/${await openReportId("Spammy Person")}`, { action: "resolved" });
  });

  it("limits how many reports one person can file in a day", async () => {
    const reporter = await person("toronto");
    const target = await person("toronto", { displayName: "Often Reported" });
    for (let i = 0; i < 10; i += 1) await reporter.post("/safety/reports", { targetUserId: target.id, reason: "other" });
    expect(await status(reporter.post("/safety/reports", { targetUserId: target.id, reason: "other" }))).toBe(429);
    for (let i = 0; i < 10; i += 1) await adminPost(`/admin/reports/${await openReportId("Often Reported")}`, { action: "resolved" });
  });

  it("emails a warning, then closes the report as warned", async () => {
    const reporter = await person("toronto");
    const target = await createPerson(BASE, "warn-me@example.test", { displayName: "Warned Person", cityId: "toronto" });
    await reporter.post("/safety/reports", { targetUserId: target.id, reason: "harassment" });
    const response = await adminPost(`/admin/reports/${await openReportId("Warned Person")}`, { action: "warned" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/admin/reports");
    const [warning] = sesRequests("warn-me@example.test");
    expect(warning?.body.Content.Simple.Subject.Data).toBe("A note about your conduct on Ideas Match");
    expect(await adminPage("/admin/reports")).not.toContain("Warned Person");
    expect(await adminPage(`/admin/users/${target.id}`)).toContain("warned");
  });

  it("keeps the report open and says so when the warning can't be sent", async () => {
    const reporter = await person("toronto");
    const target = await createPerson(BASE, "ses-reject-warn@example.test", { displayName: "Undeliverable Person", cityId: "toronto" });
    await reporter.post("/safety/reports", { targetUserId: target.id, reason: "harassment" });
    const response = await adminPost(`/admin/reports/${await openReportId("Undeliverable Person")}`, { action: "warned" });
    expect(response.headers.get("location")).toBe("/admin/reports?error=warning_failed");
    const queue = await adminPage("/admin/reports?error=warning_failed");
    expect(queue).toContain("the report is still open");
    expect(queue).toContain("Undeliverable Person");
    await adminPost(`/admin/reports/${await openReportId("Undeliverable Person")}`, { action: "resolved" });
  });

  it("shows who reported, earlier reports, and the messages around the reported one, escaped", async () => {
    const reporter = await person("toronto", { displayName: "Careful Reporter" });
    const target = await person("toronto", { displayName: "Context Person" });
    const conversationId = await match(reporter, target, "statistics-and-causal-inference");
    for (let i = 1; i <= 7; i += 1) await target.say(conversationId, `before ${i}`);
    const message = await target.say(conversationId, "<b>the bad message</b>");
    await reporter.say(conversationId, "after it");

    await reporter.post("/safety/reports", { targetUserId: target.id, reason: "spam" });
    await adminPost(`/admin/reports/${await openReportId("Context Person")}`, { action: "resolved" });
    await reporter.post("/safety/reports", { targetUserId: target.id, conversationId, messageId: message.id, reason: "harassment", evidence: await evidenceNear(reporter, conversationId, message.id) });

    const queue = await adminPage("/admin/reports");
    const article = queue.split("<article>").find((part) => part.includes("Context Person"))!;
    expect(article).toContain("Careful Reporter");
    expect(article).toContain("1 earlier report");
    expect(article).toContain("filed 2 reports");
    expect(article).toContain('class="reported"');
    expect(article).toContain("&lt;b&gt;the bad message&lt;/b&gt;");
    expect(article).not.toContain("<b>the bad message</b>");
    expect(article).toContain("after it");
    expect(article).toContain("before 7");
    expect(article).toContain("before 3");
    expect(article).not.toContain("before 2");
    await adminPost(`/admin/reports/${await openReportId("Context Person")}`, { action: "resolved" });
  });

  it("only shows moderators text that matches what was stored", async () => {
    const reporter = await person("toronto");
    const target = await person("toronto", { displayName: "Framed Person" });
    const conversationId = await match(reporter, target, "statistics-and-causal-inference");
    const real = await target.say(conversationId, "what they really said");
    const otherKey = (await target.say(conversationId, "a different message"), (await reporter.read(conversationId)).at(-1).contentKey);
    await reporter.post("/safety/reports", { targetUserId: target.id, conversationId, messageId: real.id, reason: "spam", evidence: [{ messageId: real.id, contentKey: otherKey }] });
    const article = (await adminPage("/admin/reports")).split("<article>").find((part) => part.includes("Framed Person"))!;
    expect(article).not.toContain("what they really said");
    expect(article).not.toContain("a different message");
    await adminPost(`/admin/reports/${await openReportId("Framed Person")}`, { action: "resolved" });

    const outsider = await person("toronto");
    expect(await status(outsider.post("/safety/reports", { targetUserId: target.id, conversationId, messageId: real.id, reason: "spam", evidence: [{ messageId: real.id, contentKey: otherKey }] }))).toBe(404);
  });

  it("puts urgent reports first", async () => {
    const reporter = await person("toronto");
    const urgent = await person("toronto", { displayName: "Urgent Target" });
    const ordinary = await person("toronto", { displayName: "Ordinary Target" });
    await reporter.post("/safety/reports", { targetUserId: urgent.id, reason: "underage" });
    await reporter.post("/safety/reports", { targetUserId: ordinary.id, reason: "spam" });
    const queue = await adminPage("/admin/reports");
    expect(queue.indexOf("Urgent Target")).toBeLessThan(queue.indexOf("Ordinary Target"));
    await adminPost(`/admin/reports/${await openReportId("Urgent Target")}`, { action: "resolved" });
    await adminPost(`/admin/reports/${await openReportId("Ordinary Target")}`, { action: "resolved" });
  });

  it("asks before banning from a report, and only bans once confirmed", async () => {
    const reporter = await person("toronto");
    const target = await person("toronto", { displayName: "Maybe Banned" });
    await reporter.post("/safety/reports", { targetUserId: target.id, reason: "spam" });
    const id = await openReportId("Maybe Banned");

    const unconfirmed = await adminPost(`/admin/reports/${id}`, { action: "banned" });
    expect(await unconfirmed.text()).toContain("Yes, ban Maybe Banned");
    expect((await target.get("/me")).id).toBe(target.id);
    expect(await adminPage("/admin/reports")).toContain("Maybe Banned");

    await adminPost(`/admin/reports/${id}`, { action: "banned", confirm: "yes" });
    expect(await status(target.get("/me"))).toBe(401);
    expect(await adminPage("/admin/reports")).not.toContain("Maybe Banned");
  });

  it("undoes a ban, so the person can sign back in", async () => {
    const target = await createPerson(BASE, "unban-me@example.test", { displayName: "Unbanned Person", cityId: "toronto" });
    expect((await adminPost(`/admin/users/${target.id}/ban`, {})).status).toBe(200);
    expect((await target.get("/me")).id).toBe(target.id);

    await adminPost(`/admin/users/${target.id}/ban`, { confirm: "yes" });
    expect(await status(target.get("/me"))).toBe(401);
    expect(await status(new Client(BASE).signIn("unban-me@example.test"))).toBe(403);
    expect(await adminPage(`/admin/users/${target.id}`)).toContain("Unban");

    await adminPost(`/admin/users/${target.id}/unban`, {});
    const back = await new Client(BASE).signIn("unban-me@example.test");
    expect(back.id).toBe(target.id);
    expect((await back.get("/me")).profile.displayName).toBe("Unbanned Person");
  });

  it("does not bring back a deleted account through unban", async () => {
    const target = await person("toronto");
    await target.delete("/me");
    await adminPost(`/admin/users/${target.id}/unban`, {});
    expect(await adminPage(`/admin/users/${target.id}`)).toContain("deleted");
  });

  it("finds people by name or email, treats wildcards literally, and escapes what it shows", async () => {
    const target = await createPerson(BASE, "findable-person@example.test", { displayName: "<i>Zebra</i> Findable", cityId: "toronto" });
    const byName = await adminPage("/admin/users?q=zebra");
    expect(byName).toContain("findable-person@example.test");
    expect(byName).toContain("&lt;i&gt;Zebra&lt;/i&gt;");
    expect(byName).not.toContain("<i>Zebra</i>");
    expect(await adminPage("/admin/users?q=FINDABLE-person")).toContain(target.id);
    expect(await adminPage("/admin/users?q=nobody-has-this-name")).toContain("Nobody found");
    const injected = await adminPage(`/admin/users?q=${encodeURIComponent('"><script>x</script>')}`);
    expect(injected).not.toContain("<script>x");
  });

  it("records who did what in the history", async () => {
    const reporter = await person("toronto");
    const target = await person("toronto", { displayName: "History Person" });
    await reporter.post("/safety/reports", { targetUserId: target.id, reason: "spam" });
    await adminPost(`/admin/reports/${await openReportId("History Person")}`, { action: "resolved" });
    await adminPost(`/admin/users/${target.id}/ban`, { confirm: "yes" });
    await adminPost(`/admin/users/${target.id}/unban`, {});
    const history = await adminPage("/admin/history");
    expect(history).toContain("local development");
    expect(history).toContain("resolved");
    expect(history).toContain("unbanned");
    expect(history).toContain(`/admin/users/${target.id}`);
  });

  it("removes closed reports and moderation history after two years, and keeps open reports", async () => {
    const reporter = await person("toronto");
    const closed = await person("toronto", { displayName: "Old Closed Case" });
    const open = await person("toronto", { displayName: "Old Open Case" });
    await reporter.post("/safety/reports", { targetUserId: closed.id, reason: "spam" });
    await reporter.post("/safety/reports", { targetUserId: open.id, reason: "spam" });
    await adminPost(`/admin/reports/${await openReportId("Old Closed Case")}`, { action: "resolved" });
    expect(await adminPage("/admin/history")).toContain("Reason: spam");

    const threeYearsAgo = Date.now() - 3 * 365 * 24 * 60 * 60 * 1000;
    execFileSync(
      join(apiDir, "../../node_modules/.bin/wrangler"),
      ["d1", "execute", "ideas-match", "--local", "--persist-to", DEV_DB, "--command", `UPDATE reports SET created_at = ${threeYearsAgo}, resolved_at = CASE WHEN resolved_at IS NULL THEN NULL ELSE ${threeYearsAgo} END WHERE target_user_id IN ('${closed.id}', '${open.id}'); UPDATE moderation_log SET created_at = ${threeYearsAgo} WHERE detail LIKE '%Reason: spam%';`],
      { cwd: apiDir, stdio: "pipe", env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" } },
    );
    await sweep();

    expect(await adminPage(`/admin/users/${closed.id}`)).not.toContain("Reason: spam");
    expect((await adminPage("/admin/reports"))).toContain("Old Open Case");
    expect((await adminPage("/admin/history"))).not.toContain("Reason: spam");
  }, 60_000);

  it("warns about, then deletes, an account unused for two years, unless its owner comes back", async () => {
    const wrangler = (command: string) =>
      execFileSync(join(apiDir, "../../node_modules/.bin/wrangler"), ["d1", "execute", "ideas-match", "--local", "--persist-to", DEV_DB, "--command", command], { cwd: apiDir, stdio: "pipe", env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" } });
    const day = 24 * 60 * 60 * 1000;
    const longAgo = Date.now() - 800 * day;
    const leaving = await person("toronto", { displayName: "Long Gone" });
    const returning = await person("toronto", { displayName: "Came Back" });
    wrangler(`UPDATE users SET last_active_at = ${longAgo}, created_at = ${longAgo} WHERE id IN ('${leaving.id}', '${returning.id}')`);
    await sweep();
    expect(await adminPage(`/admin/users/${leaving.id}`)).toContain("Long Gone");

    wrangler(`UPDATE users SET inactivity_warned_at = ${Date.now() - 31 * day}, last_active_at = ${longAgo} WHERE id IN ('${leaving.id}', '${returning.id}')`);
    await returning.get("/me");
    await sleep(300);
    await sweep();
    expect(await status(leaving.get("/me"))).toBe(401);
    expect(await adminPage(`/admin/users/${leaving.id}`)).toContain("deleted");
    expect((await returning.get("/me")).profile.displayName).toBe("Came Back");
  }, 90_000);

  it("lets a moderator remove one photo without touching the rest of the account", async () => {
    const target = await person("toronto", { displayName: "Photo Person" });
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const upload = await fetch(`${BASE}/me/avatar`, { method: "PUT", headers: { authorization: `Bearer ${target.token}`, "content-type": "image/png" }, body: png });
    expect(upload.status).toBe(200);
    const avatarUrl = (await target.get("/me")).profile.avatarUrl;
    expect((await fetch(avatarUrl)).status).toBe(200);
    expect(await adminPage(`/admin/users/${target.id}`)).toContain("Remove photo");

    await adminPost(`/admin/users/${target.id}/remove-photo`, {});
    const me = await target.get("/me");
    expect(me.profile.avatarUrl).toBeNull();
    expect(me.profile.displayName).toBe("Photo Person");
    expect((await fetch(avatarUrl)).status).toBe(404);
    expect(await adminPage("/admin/history")).toContain("removed photo");
  });

  it("rejects cross-site posts to the new actions", async () => {
    const target = await person("toronto");
    for (const path of [`/admin/users/${target.id}/ban`, `/admin/users/${target.id}/unban`]) {
      const response = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
        body: new URLSearchParams({ confirm: "yes" }),
      });
      expect(response.status).toBe(403);
    }
    expect((await target.get("/me")).id).toBe(target.id);
  });
});

describe("submitted topics", () => {
  it("shows only to the submitter until approved, then counts their swipe", async () => {
    const submitter = await person("san-francisco", { fields: ["law"] });
    const { id } = await submitter.post("/deck/topics", { kind: "question", title: "Should jury duty be paid at a living wage?", blurb: "<i>Fair pay.</i>", fieldTags: ["law"] });
    const other = await person("san-francisco", { fields: ["law"] });

    expect((await submitter.get("/deck/topics")).find((card: any) => card.id === id)?.pending).toBe(true);
    expect(await status(other.post(`/deck/topics/${id}/swipe`, { direction: "right" }))).toBe(404);

    const reviewPage = await (await fetch(`${BASE}/admin/topics`)).text();
    expect(reviewPage).toContain("Should jury duty");
    expect(reviewPage).toContain("&lt;i&gt;Fair pay.");

    await submitter.post(`/deck/topics/${id}/swipe`, { direction: "right", stance: "for" });
    const approve = await fetch(`${BASE}/admin/topics/${id}`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
      body: new URLSearchParams({ action: "approved" }),
    });
    expect(approve.status).toBe(302);

    const card = (await other.get("/deck/topics")).find((entry: any) => entry.id === id);
    expect(card?.pending).toBe(false);

    const joiners = await Promise.all(Array.from({ length: 3 }, () => person("san-francisco")));
    const results = [];
    for (const client of joiners) results.push(await client.post(`/deck/topics/${id}/swipe`, { direction: "right", stance: "against" }));
    const groupId = results[2].groupConversationId;
    expect(groupId).toBeTruthy();
    expect((await submitter.get(`/conversations/${groupId}`)).members).toHaveLength(4);
  });

  it("always puts someone's own suggestion in the first page, even with many ranked above it", async () => {
    const client = await person("san-francisco", { fields: ["economics", "politics", "law", "history", "philosophy", "sociology", "psychology", "medicine"] });
    const { id } = await client.post("/deck/topics", { kind: "interest", title: "A very niche corner of chemistry", fieldTags: ["chemistry"] });
    for (let i = 0; i < 5; i += 1) {
      const cards = await client.get("/deck/topics");
      expect(cards).toHaveLength(20);
      expect(cards[0].id).toBe(id);
      expect(cards[0].pending).toBe(true);
    }
  });

  it("lets a moderator edit a suggestion and set its openers before approving", async () => {
    const submitter = await person("new-york");
    const { id } = await submitter.post("/deck/topics", { kind: "interest", title: "Birdwatchng in citys", fieldTags: ["biology"] });
    const reviewPage = await adminPage("/admin/topics");
    expect(reviewPage).toContain("What got you interested in Birdwatchng in citys?");

    expect((await adminPost(`/admin/topics/${id}`, { action: "approved", title: "Birdwatching in cities", blurb: "Urban species", kind: "interest", fieldTags: "environment", openers: "" })).headers.get("location")).toBe("/admin/topics?error=invalid");

    await adminPost(`/admin/topics/${id}`, { action: "approved", title: "Birdwatching in cities", blurb: "Urban species", kind: "interest", fieldTags: "environment", openers: "Seen anything good lately?\nWhere do you go?" });
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, id);
    const detail = await a.get(`/conversations/${conversationId}`);
    expect(detail.topic.title).toBe("Birdwatching in cities");
    expect(detail.suggestedOpeners).toEqual(["Seen anything good lately?", "Where do you go?"]);
    const history = await adminPage("/admin/history");
    expect(history).toContain("Birdwatching in cities (edited title, blurb, fields)");
  });

  it("limits submissions per day", async () => {
    const client = await person("san-francisco");
    for (let i = 0; i < 5; i += 1) await client.post("/deck/topics", { kind: "interest", title: `Topic number ${i}`, fieldTags: ["art"] });
    expect(await status(client.post("/deck/topics", { kind: "interest", title: "One too many", fieldTags: ["art"] }))).toBe(429);
  });
});

describe("profile and account", () => {
  // Smallest valid JPEG header, enough to pass the signature check.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

  async function upload(client: Client, body: Uint8Array<ArrayBuffer>) {
    return fetch(`${BASE}/me/avatar`, { method: "PUT", headers: { authorization: `Bearer ${client.token}`, "content-type": "application/octet-stream" }, body });
  }

  it("uploads and serves an avatar, and refuses things that aren't images", async () => {
    const client = await person("london");
    const response = await upload(client, jpeg);
    expect(response.status).toBe(200);
    const { avatarUrl } = (await response.json()) as { avatarUrl: string };
    const image = await fetch(avatarUrl);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/jpeg");
    expect((await upload(client, new TextEncoder().encode("<svg onload=alert(1)>"))).status).toBe(415);
    expect((await upload(client, new Uint8Array(3 * 1024 * 1024))).status).toBe(413);
  });

  it("updates a profile", async () => {
    const client = await person("london");
    const updated = await client.put("/me/profile", { displayName: "Renamed", bio: "New bio", role: "researcher", fields: ["art"], lookingFor: ["friends"] });
    expect(updated.profile.displayName).toBe("Renamed");
  });

  it("stores and removes a push token", async () => {
    const client = await person("london");
    const token = { token: "ExponentPushToken[abc123def456]", platform: "android" };
    await client.post("/me/push-token", token);
    await client.request("DELETE", "/me/push-token", token);
  });

  it("deletes an account and everything it said", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "aging-and-longevity-science");
    await a.say(conversationId, "delete me");

    const group = await Promise.all(Array.from({ length: 3 }, () => person("new-york")));
    let groupId: string | null = null;
    for (const client of [a, ...group]) groupId = (await client.post("/deck/topics/nutrition-science/swipe", { direction: "right" })).groupConversationId ?? groupId;
    await a.say(groupId!, "delete me too");
    expect((await group[0]!.read(groupId!)).some((m: any) => m.body === "delete me too")).toBe(true);

    await a.delete("/me");
    expect(await status(a.get("/me"))).toBe(401);
    expect((await b.get("/conversations")).map((row: any) => row.id)).not.toContain(conversationId);

    const remaining = await group[0]!.read(groupId!);
    expect(remaining.some((m: any) => m.body === "delete me too")).toBe(false);
    expect((await group[0]!.get(`/conversations/${groupId}`)).members).toHaveLength(3);
    const inbox = (await group[0]!.get("/conversations")).find((row: any) => row.id === groupId);
    expect(inbox.lastMessagePreview).toBeNull();

    // App messages named them too, and those stay for the people still in the chat.
    const vanishing = await person("new-york", { displayName: "Vanishing" });
    const stayers = await Promise.all(Array.from({ length: 3 }, () => person("new-york")));
    let chat: string | null = null;
    for (const client of [vanishing, ...stayers]) chat = (await client.post("/deck/topics/nutrition-science/swipe", { direction: "right" })).groupConversationId ?? chat;
    await vanishing.post(`/meetups?conversationId=${chat}`, { startsAt: Date.now() + 3_600_000, endsAt: Date.now() + 7_200_000, venueKind: "cafe", venueNote: "" });
    expect((await stayers[0]!.get(`/conversations/${chat}/messages`)).some((m: any) => m.body.startsWith("Vanishing proposed"))).toBe(true);
    await vanishing.delete("/me");
    const left = await stayers[0]!.get(`/conversations/${chat}/messages`);
    expect(left.some((m: any) => m.body.includes("Vanishing"))).toBe(false);
    expect(left.some((m: any) => m.body.startsWith("Someone proposed a meetup"))).toBe(true);
    expect((await stayers[0]!.get("/conversations")).find((row: any) => row.id === chat).lastMessagePreview ?? "").not.toContain("Vanishing");

    // The same email can start over as a brand new person.
    const again = await new Client(BASE).signIn(a.email);
    expect(again.id).not.toBe(a.id);
    expect((await again.get("/me")).onboarded).toBe(false);
  });
});

describe("crash reports and public pages", () => {
  it("accepts a crash report without a session and shows it to moderators, grouped and escaped", async () => {
    const report = { message: "<b>TypeError</b> in deck", stack: "at Deck (deck.tsx:1)", fatal: true, platform: "android", appVersion: "0.1.0" };
    for (let i = 0; i < 2; i += 1) expect(await status(new Client(BASE).post("/client-errors", report))).toBe(200);
    const page = await adminPage("/admin/crashes");
    expect(page).toContain("&lt;b&gt;TypeError&lt;/b&gt; in deck");
    expect(page).not.toContain("<b>TypeError</b>");
    expect(page).toContain("2 times");
  });

  it("publishes the policy, terms, and safety page in English and French, and escapes nothing into markup", async () => {
    for (const [path, title, lang] of [["/privacy", "Privacy policy", "en"], ["/terms", "Terms of use", "en"], ["/safety", "Safety standards", "en"], ["/confidentialite", "Politique de confidentialité", "fr"], ["/conditions", "Conditions d'utilisation", "fr"], ["/securite", "Normes de sécurité", "fr"]] as const) {
      const response = await fetch(`${BASE}${path}`);
      expect(response.status).toBe(200);
      const page = await response.text();
      expect(page).toContain(`<html lang="${lang}">`);
      expect(page).toContain(`<h1>${title}</h1>`);
      expect(page).not.toContain("**");
      expect(page).not.toContain("[contact address]");
    }
    expect(await (await fetch(`${BASE}/terms`)).text()).toContain("<strong>If you live in Quebec");
  });

  it("serves French to people whose phone is in French, and records it for push", async () => {
    const french = await person("new-york", { displayName: "Camille" });
    const other = await person("new-york", { displayName: "Robin" });
    const frenchGet = async (path: string) => (await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${french.token}`, "accept-language": "fr-CA" } })).json() as Promise<any>;

    const deck = await frenchGet("/deck/topics");
    expect(deck.some((card: any) => card.id === "behavioral-economics" || card.title.startsWith("Faut-il"))).toBe(true);
    const englishDeck = await other.get("/deck/topics");
    const shared = englishDeck.find((card: any) => deck.some((row: any) => row.id === card.id))!;
    expect(deck.find((row: any) => row.id === shared.id).title).not.toBe(shared.title);

    const conversationId = await match(french, other, "behavioral-economics");
    const detail = await frenchGet(`/conversations/${conversationId}`);
    expect(detail.topic.title).toBe("Économie comportementale");
    expect(detail.suggestedOpeners[0]).toContain("Quel résultat classique");

    const [opener] = await french.get(`/conversations/${conversationId}/messages`);
    expect(opener.body).toMatch(/^You both want to dig into Behavioural economics\. /);
    expect(opener.bodyFr).toMatch(/^Vous voulez tous les deux explorer Économie comportementale\. /);
    const inbox = await frenchGet("/conversations");
    expect(inbox.find((row: any) => row.id === conversationId).lastMessagePreview).toMatch(/^Vous voulez/);
    expect((await other.get("/conversations")).find((row: any) => row.id === conversationId).lastMessagePreview).toMatch(/^You both/);

    const invite = await (await fetch(`${BASE}/invite`, { headers: { "accept-language": "fr" } })).text();
    expect(invite).toContain("Obtenir l'application Android");
    expect(await (await fetch(`${BASE}/t/behavioral-economics`, { headers: { "accept-language": "fr" } })).text()).toContain("Économie comportementale");
  });

  it("shows a city's lean only once enough people answered and they disagree, and counts meetups held from five", async () => {
    const topic = "should-zoos-exist";
    const answer = async (stance: string) => (await person("boston")).post(`/deck/topics/${topic}/swipe`, { direction: "right", stance });
    // Asks a brand new person, passing on cards until this topic comes up.
    const cardForNewPerson = async () => {
      const viewer = await person("boston");
      for (let page = 0; page < 15; page += 1) {
        const cards = await viewer.get("/deck/topics");
        const card = cards.find((row: any) => row.id === topic);
        if (card) return card;
        for (const row of cards) await viewer.post(`/deck/topics/${row.id}/swipe`, { direction: "left" });
      }
      throw new Error("topic never came up");
    };

    for (let i = 0; i < 10; i += 1) await answer("for");
    expect((await cardForNewPerson()).lean).toBeNull();
    await answer("against");
    const card = await cardForNewPerson();
    expect(card.lean).toEqual({ for: 91, against: 9, unsure: 0 });
    expect(card.meetupsHeld).toBeNull();

    const held: { client: Client; id: string }[] = [];
    for (let i = 0; i < 5; i += 1) {
      const [a, b] = [await person("new-york"), await person("new-york")];
      const chat = await match(a, b, topic);
      const soon = Date.now();
      const meetup = await a.post(`/meetups?conversationId=${chat}`, { startsAt: soon + 500, endsAt: soon + 1000, venueKind: "cafe", venueNote: "" });
      await b.post(`/meetups/${meetup.id}/respond`, { response: "yes" });
      held.push({ client: a, id: meetup.id });
    }
    await sleep(2000);
    await sweep();
    for (const { client, id } of held) await client.post(`/meetups/${id}/did-meet`, { didMeet: true });
    expect((await cardForNewPerson()).meetupsHeld).toBe(5);
  }, 120_000);

  it("filters the deck by field group", async () => {
    const viewer = await person("toronto");
    const arts = await viewer.get("/deck/topics?group=arts");
    expect(arts.length).toBeGreaterThan(0);
    expect(arts.every((card: any) => card.fieldTags.some((tag: string) => ["art", "music_film"].includes(tag)))).toBe(true);
  });

  it("rejects oversized crash reports", async () => {
    expect(await status(new Client(BASE).post("/client-errors", { message: "x".repeat(1001) }))).toBe(400);
  });

  it("sends security headers and offers the app on invite pages", async () => {
    const response = await fetch(`${BASE}/invite`);
    expect(response.headers.get("x-frame-options")).toBeTruthy();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain("Get the Android app");
    expect(await (await fetch(`${BASE}/t/poetry`)).text()).toContain("Get the Android app");
    expect((await fetch(`${BASE}/download/android`)).status).toBe(404);
  });
});

describe("universal links", () => {
  it("serves both association files", async () => {
    const apple = await (await fetch(`${BASE}/.well-known/apple-app-site-association`)).json();
    expect(JSON.stringify(apple)).toContain("/auth/link");
    expect((await fetch(`${BASE}/.well-known/assetlinks.json`)).status).toBe(200);
  });
});

describe("seed script", () => {
  it("produces a match and a group through the real API", () => {
    const output = execFileSync("node", ["scripts/seed-dev.ts"], { cwd: apiDir, env: { ...process.env, API_URL: BASE }, encoding: "utf8", timeout: 120_000 });
    expect(output).toContain("Seeded 30 people");
    expect(output).toContain("true");
  }, 150_000);
});

describe("the app's API client", () => {
  // Runs the real client module from the mobile app against the real Worker.
  async function loadClient() {
    process.env.EXPO_PUBLIC_API_URL = BASE;
    return import("../../mobile/src/api.ts");
  }

  it("keeps the session when an old sign-in link or wrong code is rejected", async () => {
    const client = await loadClient();
    const signedIn = await person("london");
    let signedOut = 0;
    client.setSessionToken(signedIn.token);
    client.setUnauthorizedHandler(() => {
      signedOut += 1;
    });

    const { devToken } = await new Client(BASE).post("/auth/start", { email: signedIn.email });
    await new Client(BASE).post("/auth/verify", { token: devToken });

    await expect(client.api.post("/auth/verify", { token: devToken })).rejects.toMatchObject({ status: 401, code: "invalid_or_expired" });
    await expect(client.api.post("/auth/verify", { email: signedIn.email, code: "000000" })).rejects.toMatchObject({ status: 401 });
    expect(signedOut).toBe(0);
    expect((await client.api.get<{ id: string }>("/me")).id).toBe(signedIn.id);

    client.setUnauthorizedHandler(null);
    client.setSessionToken(null);
  });

  it("ends the session when the server rejects it everywhere else", async () => {
    const client = await loadClient();
    let signedOut = 0;
    client.setSessionToken("a-session-that-does-not-exist");
    client.setUnauthorizedHandler(() => {
      signedOut += 1;
    });

    await expect(client.api.get("/me")).rejects.toMatchObject({ status: 401 });
    expect(signedOut).toBe(1);

    client.setUnauthorizedHandler(null);
    client.setSessionToken(null);
  });

  it("says plainly when the server can't be reached", async () => {
    const client = await loadClient();
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new TypeError("offline"));
    try {
      const error = await client.api.get("/me").catch((caught: unknown) => caught);
      expect(client.friendlyError(error)).toContain("Check your connection");
    } finally {
      globalThis.fetch = original;
    }
  });
});
