import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { runSweep } from "./cron";
import admin from "./routes/admin";
import auth from "./routes/auth";
import conversations from "./routes/conversations";
import deck from "./routes/deck";
import me from "./routes/me";
import meetups from "./routes/meetups";
import people from "./routes/people";
import publicRoutes from "./routes/public";
import safety from "./routes/safety";
import type { AppEnv } from "./types";

export { ChatRoom } from "./do/ChatRoom";
export { Cohort } from "./do/Cohort";

const app = new Hono<AppEnv>();

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  console.error(JSON.stringify({ event: "unhandled_error", path: c.req.path, error: String(error), stack: error.stack }));
  return c.json({ error: "internal_error" }, 500);
});

app.route("/", publicRoutes);
app.route("/auth", auth);
app.route("/me", me);
app.route("/deck", deck);
app.route("/people", people);
app.route("/conversations", conversations);
app.route("/meetups", meetups);
app.route("/safety", safety);
app.route("/admin", admin);

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runSweep(env));
  },
} satisfies ExportedHandler<Env>;
