import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

export function fail(status: ContentfulStatusCode, error: string): HTTPException {
  return new HTTPException(status, { res: new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } }) });
}

export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw fail(400, "invalid_json");
  }
  const result = schema.safeParse(body);
  if (!result.success) throw fail(400, "invalid_request");
  return result.data;
}
