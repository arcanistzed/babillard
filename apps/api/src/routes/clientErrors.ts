import { clientErrorSchema } from "@ideas-match/shared";
import { Hono } from "hono";
import { getDb, schema } from "../db";
import { clientIp } from "../lib/config";
import { fail, parseJson } from "../lib/http";
import { newId } from "../lib/tokens";
import type { AppEnv } from "../types";

const clientErrors = new Hono<AppEnv>();

/** Open to anyone, since a crash can happen before sign-in. It takes no identity, and rate-limits by network. */
clientErrors.post("/", async (c) => {
  const { success } = await c.env.CLIENT_ERROR_LIMIT.limit({ key: clientIp(c.env, (name) => c.req.header(name)) });
  if (!success) throw fail(429, "too_many_attempts");
  const input = await parseJson(c, clientErrorSchema);
  await getDb(c.env).insert(schema.clientErrors).values({ id: newId(), ...input, createdAt: Date.now() });
  console.error(JSON.stringify({ event: "client_error", fatal: input.fatal, message: input.message.slice(0, 200), appVersion: input.appVersion }));
  return c.json({ ok: true }, 201);
});

export default clientErrors;
