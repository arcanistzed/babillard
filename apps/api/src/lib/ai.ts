import type { Field, WordingSuggestion } from "@babillard/shared";

/**
 * Drafting help from OpenAI, only for topic wording. Only the text of a suggested topic
 * is sent: never messages, names, or anything else about a person.
 */

interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

const DEFAULT_MODEL = "gpt-5-mini";
const TIMEOUT_MS = 25_000;

export function aiAvailable(env: Env): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

/** Asks for JSON matching the schema. Returns null if the service is off, slow, or answers something unusable. */
async function askForJson<T>(env: Env, name: string, schema: JsonSchema, instructions: string, input: string): Promise<T | null> {
  if (!aiAvailable(env)) return null;
  try {
    const response = await fetch(env.OPENAI_ENDPOINT || "https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || DEFAULT_MODEL,
        instructions,
        input,
        reasoning: { effort: "low" },
        text: { format: { type: "json_schema", name, schema, strict: true } },
        // The text is a suggestion for a public topic, but it still shouldn't be kept for training.
        store: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ event: "ai_error", status: response.status, body: (await response.text()).slice(0, 300) }));
      return null;
    }
    const data = (await response.json()) as { output_text?: string; output?: { type: string; content?: { type: string; text?: string }[] }[] };
    const text = data.output_text ?? data.output?.find((item) => item.type === "message")?.content?.find((part) => part.type === "output_text")?.text;
    return text ? (JSON.parse(text) as T) : null;
  } catch (error) {
    console.error(JSON.stringify({ event: "ai_error", error: String(error) }));
    return null;
  }
}

const STYLE = `Write plain, neutral, natural wording in Canadian spelling (colour, centre, neighbour). Never take a side, add facts, or add claims the person didn't make. A question is a yes-or-no question someone could answer For, Against, or Not sure. An interest is a short noun phrase, not a question. A blurb is one short line, under 80 characters, that doesn't restate the title. For a question, name the tension, like "Safer streets against parking and traffic." For an interest, name what makes it interesting, like "Why some places are pleasant to be in on foot." Don't start it with "Debate", "Discussion", or "Exploring". In French, the same way, like "La pratique à la maison contre le temps libre des enfants." French is Canadian French with no space before ?, !, or :.`;

/** The model sometimes spaces punctuation the way France does. Canadian usage, which the app follows, doesn't. */
export function tidyFrench(text: string): string {
  return text.replace(/[\s  ]+([?!:;])/g, "$1");
}

/** A clearer version of someone's topic suggestion, in the language they wrote it in. */
export async function suggestWording(env: Env, input: { kind: "interest" | "question"; title: string; blurb: string; language: "en" | "fr" }): Promise<WordingSuggestion | null> {
  const language = input.language === "fr" ? "Canadian French" : "Canadian English";
  const suggestion = await askForJson<WordingSuggestion>(
    env,
    "wording_suggestion",
    { type: "object", properties: { title: { type: "string" }, blurb: { type: "string" } }, required: ["title", "blurb"], additionalProperties: false },
    `You help people word a discussion topic for an app where people meet in person to talk about ideas. Rewrite it so it's clear and inviting, keeping the person's meaning. ${STYLE} Answer in ${language}. Keep the title under 90 characters. If the blurb is empty, write one.`,
    JSON.stringify({ kind: input.kind, title: input.title, blurb: input.blurb }),
  );
  if (!suggestion || input.language !== "fr") return suggestion;
  return { title: tidyFrench(suggestion.title), blurb: tidyFrench(suggestion.blurb) };
}

export type PlaceChoice = "city" | "province" | "country" | "everywhere";

export interface ModeratorDraft {
  kind: "interest" | "question";
  title: string;
  blurb: string;
  openers: string[];
  fr: { title: string; blurb: string; openers: string[] };
  place: PlaceChoice;
  placeReason: string;
}

/** Everything a moderator fills in before approving, as a starting point they can change. */
export async function draftForModerator(env: Env, input: { kind: string; title: string; blurb: string; fieldTags: Field[]; city: string; province: string }): Promise<ModeratorDraft | null> {
  const lines = { type: "array", items: { type: "string" } };
  const draft = await askForJson<ModeratorDraft>(
    env,
    "moderator_draft",
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["interest", "question"] },
        title: { type: "string" },
        blurb: { type: "string" },
        openers: lines,
        fr: { type: "object", properties: { title: { type: "string" }, blurb: { type: "string" }, openers: lines }, required: ["title", "blurb", "openers"], additionalProperties: false },
        place: { type: "string", enum: ["city", "province", "country", "everywhere"] },
        placeReason: { type: "string" },
      },
      required: ["kind", "title", "blurb", "openers", "fr", "place", "placeReason"],
      additionalProperties: false,
    },
    `You help a moderator approve a topic someone suggested for an app where people meet in person to talk about ideas. Tidy the English wording, keeping the meaning. Write two conversation openers: short, friendly questions that start a real conversation, not quiz questions. Translate all of it into Canadian French. ${STYLE} Then recommend where the topic should appear: "city" if it's about the suggester's city, "province" if it's about their province, "country" if it's about Canada, or "everywhere" if people anywhere could discuss it. Give the reason in one short sentence.`,
    JSON.stringify({ ...input }),
  );
  if (!draft) return null;
  return { ...draft, fr: { title: tidyFrench(draft.fr.title), blurb: tidyFrench(draft.fr.blurb), openers: draft.fr.openers.map(tidyFrench) } };
}
