import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ApiError, Client, createPerson, type PersonSeed } from "../scripts/api-client.ts";
import { loginEmailContent } from "../src/lib/loginEmailContent.ts";

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "http://localhost:8799";
const PROD = "http://localhost:8798";

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

  it("closes admin pages when Access is not configured", async () => {
    expect((await fetch(`${PROD}/admin`)).status).toBe(403);
    expect((await fetch(`${PROD}/admin/reports`, { headers: { "cf-access-jwt-assertion": "forged" } })).status).toBe(403);
    expect((await fetch(`${PROD}/admin/topics`, { method: "POST" })).status).toBe(403);
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

  it("includes the link on the API's own domain", () => {
    const email = loginEmailContent("123456", "https://api.example.org/auth/link?token=abc");
    expect(email.text).toContain("https://api.example.org/auth/link?token=abc");
    expect(email.html).toContain('href="https://api.example.org/auth/link?token=abc"');
    expect(email.text).toContain("Both expire");
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
    expect(await status(client.put("/me/onboarding", { ...profile, dob: `${year}-01-01` }))).toBe(403);
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
    expect(localities.filter((l: any) => l.kind === "city").length).toBe(5);
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

    socketA.socket.send(JSON.stringify({ type: "send", body: "hello from a", clientId: "c1" }));
    await waitFor(async () => socketB.events, (events) => events.some((e) => e.message?.body === "hello from a"), "b receiving");
    socketB.socket.send(JSON.stringify({ type: "send", body: "hello from b" }));
    await waitFor(async () => socketA.events, (events) => events.some((e) => e.message?.body === "hello from b"), "a receiving");

    await sleep(300);
    expect(pushLog().filter((push) => push.title === "Sender" && push.data.id === conversationId)).toHaveLength(0);
    socketA.socket.close();
    socketB.socket.close();
  });

  it("does not store a retried message twice", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "language-learning");
    await a.post(`/conversations/${conversationId}/messages`, { body: "once", clientId: "retry-1" });
    await a.post(`/conversations/${conversationId}/messages`, { body: "once", clientId: "retry-1" });
    const texts = (await b.get(`/conversations/${conversationId}/messages`)).filter((m: any) => m.kind === "text");
    expect(texts).toHaveLength(1);
  });

  it("pushes someone offline and tracks their unread count", async () => {
    const a = await person("new-york", { displayName: "Offline Sender" });
    const b = await person("new-york");
    const conversationId = await match(a, b, "endangered-languages");
    await a.post(`/conversations/${conversationId}/messages`, { body: "are you there" });

    const pushes = await waitFor(
      async () => pushLog().filter((push) => push.title === "Offline Sender"),
      (rows) => rows.length > 0,
      "offline push",
    );
    expect(pushes[0]?.userIds).toEqual([b.id]);

    const item = (await b.get("/conversations")).find((c: any) => c.id === conversationId);
    expect(item.unreadCount).toBe(1);
    expect(item.lastMessagePreview).toBe("are you there");
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
    expect(await status(stranger.post(`/conversations/${conversationId}/messages`, { body: "hi" }))).toBe(403);
    await expect(openSocket(stranger, conversationId)).rejects.toThrow();
  });

  it("pages back through history", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "translation-and-world-literature");
    for (let i = 0; i < 3; i += 1) await a.post(`/conversations/${conversationId}/messages`, { body: `m${i}` });
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
    expect(await status(people[0]!.post(`/conversations/${groupId}/messages`, { body: "still here?" }))).toBe(403);
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
    expect(await status(a.post(`/conversations/${conversationId}/messages`, { body: "too late" }))).toBe(403);
    expect(await status(a.get(`/conversations/${conversationId}`))).toBe(410);
  });

  it("leaves a match alone once someone has written", async () => {
    const a = await person("new-york");
    const b = await person("new-york");
    const conversationId = await match(a, b, "animal-cognition");
    await a.post(`/conversations/${conversationId}/messages`, { body: "hi" });
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
    expect(await status(b.post(`/conversations/${conversationId}/messages`, { body: "hello?" }))).toBe(403);

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
    await b!.post(`/conversations/${groupId}/messages`, { body: "visible to some" });

    expect((await a!.get(`/conversations/${groupId}/messages`)).some((m: any) => m.body === "visible to some")).toBe(false);
    expect((await c!.get(`/conversations/${groupId}/messages`)).some((m: any) => m.body === "visible to some")).toBe(true);
    expect((await a!.get("/conversations")).find((row: any) => row.id === groupId).unreadCount).toBe(0);
  });

  it("carries a report through the admin queue to a ban that ends the session", async () => {
    const reporter = await person("new-york");
    const target = await person("new-york", { displayName: "Reported Person" });
    const conversationId = await match(reporter, target, "microbiome-research");
    const message = await target.post(`/conversations/${conversationId}/messages`, { body: "<b>rude message</b>" });
    await reporter.post("/safety/reports", { targetUserId: target.id, conversationId, messageId: message.id, reason: "harassment", note: "Please look" });

    const queue = await (await fetch(`${BASE}/admin/reports`)).text();
    expect(queue).toContain("Reported Person");
    expect(queue).toContain("&lt;b&gt;rude message&lt;/b&gt;");
    expect(queue).not.toContain("<b>rude message</b>");

    const reportId = /Reported Person[^]*?\/admin\/reports\/([0-9a-f-]+)"/.exec(queue)?.[1];
    expect(reportId).toBeTruthy();
    const form = new URLSearchParams({ action: "banned" });
    const ban = await fetch(`${BASE}/admin/reports/${reportId}`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
      body: form,
    });
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
    await a.post(`/conversations/${conversationId}/messages`, { body: "delete me" });

    const group = await Promise.all(Array.from({ length: 3 }, () => person("new-york")));
    let groupId: string | null = null;
    for (const client of [a, ...group]) groupId = (await client.post("/deck/topics/nutrition-science/swipe", { direction: "right" })).groupConversationId ?? groupId;
    await a.post(`/conversations/${groupId}/messages`, { body: "delete me too" });
    expect((await group[0]!.get(`/conversations/${groupId}/messages`)).some((m: any) => m.body === "delete me too")).toBe(true);

    await a.delete("/me");
    expect(await status(a.get("/me"))).toBe(401);
    expect((await b.get("/conversations")).map((row: any) => row.id)).not.toContain(conversationId);

    const remaining = await group[0]!.get(`/conversations/${groupId}/messages`);
    expect(remaining.some((m: any) => m.body === "delete me too")).toBe(false);
    expect((await group[0]!.get(`/conversations/${groupId}`)).members).toHaveLength(3);
    const inbox = (await group[0]!.get("/conversations")).find((row: any) => row.id === groupId);
    expect(inbox.lastMessagePreview).toBeNull();

    // The same email can start over as a brand new person.
    const again = await new Client(BASE).signIn(a.email);
    expect(again.id).not.toBe(a.id);
    expect((await again.get("/me")).onboarded).toBe(false);
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
