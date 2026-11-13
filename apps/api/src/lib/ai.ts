import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Field, WordingSuggestion } from "@babillard/shared";
import { z } from "zod";

/**
 * Drafting help from Claude, only for topic wording. Only the text of a suggested topic
 * is sent: never messages, names, or anything else about a person.
 */

const DEFAULT_MODEL = "claude-opus-5-5";
const TIMEOUT_MS = 25_000;

export function aiAvailable(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/** Asks for JSON matching the schema. Returns null if the service is off, slow, declines, or answers something unusable. */
async function askForJson<T>(env: Env, schema: z.ZodType<T>, instructions: string, input: string): Promise<T | null> {
  if (!aiAvailable(env)) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || null, timeout: TIMEOUT_MS, maxRetries: 1 });
  try {
    const response = await client.beta.messages.parse({
      model: env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 4000,
      // If a safety check declines the request, the API retries it on a fallback model instead of returning nothing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(schema) },
      system: instructions,
      messages: [{ role: "user", content: input }],
    });
    if (response.stop_reason !== "end_turn") {
      console.error(JSON.stringify({ event: "ai_error", stopReason: response.stop_reason }));
      return null;
    }
    return response.parsed_output ?? null;
  } catch (error) {
    console.error(JSON.stringify({ event: "ai_error", status: error instanceof Anthropic.APIError ? error.status : undefined, error: String(error).slice(0, 300) }));
    return null;
  }
}

const STYLE = `Write plain, neutral, natural wording in Canadian spelling (colour, centre, neighbour). Never take a side, add facts, or add claims the person didn't make. A question is a yes-or-no question someone could answer For, Against, or Not sure. An interest is a short noun phrase, not a question. A blurb is one short line, under 80 characters, that doesn't restate the title. For a question, name the tension, like "Safer streets against parking and traffic." For an interest, name what makes it interesting, like "Why some places are pleasant to be in on foot." Don't start it with "Debate", "Discussion", or "Exploring". In French, the same way, like "La pratique à la maison contre le temps libre des enfants." French is Canadian French with no space before ?, !, or :.`;

/** The model sometimes spaces punctuation the way France does. Canadian usage, which the app follows, doesn't. */
export function tidyFrench(text: string): string {
  return text.replace(/[\s  ]+([?!:;])/g, "$1");
}

const wordingSchema = z.object({ title: z.string(), blurb: z.string() });

/** A clearer version of someone's topic suggestion, in the language they wrote it in. */
export async function suggestWording(env: Env, input: { kind: "interest" | "question"; title: string; blurb: string; language: "en" | "fr" }): Promise<WordingSuggestion | null> {
  const language = input.language === "fr" ? "Canadian French" : "Canadian English";
  const suggestion = await askForJson(
    env,
    wordingSchema,
    `You help people word a discussion topic for an app where people meet in person to talk about ideas. Rewrite it so it's clear and inviting, keeping the person's meaning. ${STYLE} Answer in ${language}. Keep the title under 90 characters. If the blurb is empty, write one.`,
    JSON.stringify({ kind: input.kind, title: input.title, blurb: input.blurb }),
  );
  if (!suggestion || input.language !== "fr") return suggestion;
  return { title: tidyFrench(suggestion.title), blurb: tidyFrench(suggestion.blurb) };
}

export type PlaceChoice = "city" | "province" | "country" | "everywhere";

const moderatorDraftSchema = z.object({
  kind: z.enum(["interest", "question"]),
  title: z.string(),
  blurb: z.string(),
  openers: z.array(z.string()),
  fr: z.object({ title: z.string(), blurb: z.string(), openers: z.array(z.string()) }),
  place: z.enum(["city", "province", "country", "everywhere"]),
  placeReason: z.string(),
});

export type ModeratorDraft = z.infer<typeof moderatorDraftSchema>;

/** Everything a moderator fills in before approving, as a starting point they can change. */
export async function draftForModerator(env: Env, input: { kind: string; title: string; blurb: string; fieldTags: Field[]; city: string; province: string }): Promise<ModeratorDraft | null> {
  const draft = await askForJson(
    env,
    moderatorDraftSchema,
    `You help a moderator approve a topic someone suggested for an app where people meet in person to talk about ideas. Tidy the English wording, keeping the meaning. Write two conversation openers: short, friendly questions that start a real conversation, not quiz questions. Translate all of it into Canadian French. ${STYLE} Then recommend where the topic should appear: "city" if it's about the suggester's city, "province" if it's about their province, "country" if it's about Canada, or "everywhere" if people anywhere could discuss it. Give the reason in one short sentence.`,
    JSON.stringify({ ...input }),
  );
  if (!draft) return null;
  return { ...draft, fr: { title: tidyFrench(draft.fr.title), blurb: tidyFrench(draft.fr.blurb), openers: draft.fr.openers.map(tidyFrench) } };
}
