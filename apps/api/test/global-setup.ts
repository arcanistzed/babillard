// Starts real local Workers with a throwaway database, then tears them down.
// One runs in dev mode. The other runs with production-like settings, so the
// tests can prove the protections that dev mode turns off.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { appendFileSync, createWriteStream, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const persist = ".wrangler/e2e";
const wrangler = join(apiDir, "../../node_modules/.bin/wrangler");
export const DEV_PORT = 8799;
export const PROD_PORT = 8798;
export const SES_PORT = 8797;

/** Stands in for Amazon SES. Records each request, and refuses addresses containing "ses-reject". */
function startFakeSes() {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const parsed = JSON.parse(body);
      appendFileSync(
        join(apiDir, persist, "ses.jsonl"),
        `${JSON.stringify({ method: request.method, path: request.url, authorization: request.headers.authorization, amzDate: request.headers["x-amz-date"], body: parsed })}\n`,
      );
      const rejected = parsed.Destination.ToAddresses.some((to: string) => to.includes("ses-reject"));
      response.writeHead(rejected ? 400 : 200, { "content-type": "application/json", ...(rejected ? { "x-amzn-errortype": "MessageRejected" } : {}) });
      response.end(JSON.stringify(rejected ? { message: "Email address is not verified." } : { MessageId: "fake-message-id" }));
    });
  });
  server.listen(SES_PORT);
  return server;
}

function runWrangler(args: string[]): void {
  execFileSync(wrangler, args, { cwd: apiDir, stdio: "pipe", env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" } });
}

function startServer(port: number, logName: string, persistDir: string, vars: Record<string, string>): ChildProcess {
  const log = createWriteStream(join(apiDir, persist, logName));
  const varFlags = Object.entries(vars).flatMap(([key, value]) => ["--var", `${key}:${value}`]);
  const child = spawn(
    wrangler,
    ["dev", "--port", String(port), "--inspector-port", String(port + 1000), "--persist-to", persistDir, "--test-scheduled", "--show-interactive-dev-session=false", "--log-level", "log", ...varFlags],
    { cwd: apiDir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" } },
  );
  // Both streams share one log, so neither may close it when it ends first.
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  return child;
}

async function waitForHealthy(port: number): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}/healthz`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Worker on port ${port} did not become healthy`);
}

export default async function setup() {
  rmSync(join(apiDir, persist), { recursive: true, force: true });
  mkdirSync(join(apiDir, persist), { recursive: true });

  const devDb = join(persist, "dev");
  const prodDb = join(persist, "prod");
  execFileSync("node", ["scripts/gen-seed-sql.ts"], { cwd: apiDir, stdio: "pipe" });
  for (const dir of [devDb, prodDb]) {
    runWrangler(["d1", "migrations", "apply", "ideas-match", "--local", "--persist-to", dir]);
    runWrangler(["d1", "execute", "ideas-match", "--local", "--persist-to", dir, "--file", "seed/seed.sql"]);
  }

  const ses = startFakeSes();
  const dev = startServer(DEV_PORT, "dev.log", devDb, {
    AUTH_SECRET: "e2e-secret",
    DEV_MODE: "true",
    PUSH_MODE: "log",
    EMAIL_FROM: "Ideas Match <login@example.test>",
    ADMIN_EMAIL: "admin@example.test",
    SES_REGION: "ca-central-1",
    SES_ENDPOINT: `http://localhost:${SES_PORT}`,
    SES_ACCESS_KEY_ID: "AKIAE2EFAKEKEY",
    SES_SECRET_ACCESS_KEY: "e2e-fake-secret-value",
    PUBLIC_ORIGIN: `http://localhost:${DEV_PORT}`,
    NUDGE_AFTER_MS: "2000",
    MATCH_EXPIRY_MS: "4000",
    MEETUP_CHECKIN_DELAY_MS: "500",
  });
  const prod = startServer(PROD_PORT, "prod.log", prodDb, {
    AUTH_SECRET: "e2e-secret",
    DEV_MODE: "false",
    PUSH_MODE: "log",
    PUBLIC_ORIGIN: `http://localhost:${PROD_PORT}`,
    EMAIL_FROM: "Ideas Match <login@example.test>",
    SES_REGION: "ca-central-1",
    SES_ENDPOINT: `http://localhost:${SES_PORT}`,
    SES_ACCESS_KEY_ID: "AKIAE2EFAKEKEY",
    SES_SECRET_ACCESS_KEY: "e2e-fake-secret-value",
  });
  await Promise.all([waitForHealthy(DEV_PORT), waitForHealthy(PROD_PORT)]);

  return () => {
    dev.kill("SIGTERM");
    prod.kill("SIGTERM");
    ses.close();
  };
}
