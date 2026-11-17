// Publishes the app's JavaScript and images as an over-the-air update. Installs pick it up in the
// background and switch to it on their next launch. Run from apps/mobile:
//   node scripts/update-android.ts "What changed"
//
// An update only reaches installs with the same native fingerprint. If native code changed since the
// last APK release, nobody could receive this update, so it refuses and asks for a full release instead.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const API_URL = "https://babillard.app";
const mobileDir = resolve(import.meta.dirname, "..");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function run(command: string, args: string[], capture = false, env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync(command, args, { cwd: mobileDir, encoding: "utf8", env, stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" }) ?? "";
}

/**
 * The fingerprint of the native code in this checkout, which installs must match to take an update.
 * app.config.ts adds the sign-in link settings only for the real API host, so it's computed with the
 * same address the release build uses, not whatever a local .env says.
 */
export function runtimeVersion(dir: string): string {
  const output = execFileSync("npx", ["expo-updates", "runtimeversion:resolve", "--platform", "android"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, EXPO_PUBLIC_API_URL: API_URL },
    stdio: ["ignore", "pipe", "ignore"],
  });
  const json = output.split("\n").find((line) => line.startsWith("{"));
  if (!json) fail("Couldn't work out the app's runtime version.");
  return (JSON.parse(json) as { runtimeVersion: string }).runtimeVersion;
}

if (import.meta.main) {
  if (run("git", ["status", "--porcelain"], true).trim()) fail("Commit your changes first, so the update matches the repository.");
  const message = process.argv[2] ?? run("git", ["log", "-1", "--format=%s"], true).trim();

  const runtime = runtimeVersion(mobileDir);
  const latest = JSON.parse(run("gh", ["release", "view", "--json", "tagName,body"], true)) as { tagName: string; body: string };
  const released = /Runtime fingerprint: ([0-9a-f]+)/.exec(latest.body)?.[1];
  if (!released) fail(`${latest.tagName} doesn't record its runtime fingerprint, so this can't tell whether installs can take the update.`);
  if (released !== runtime) {
    fail(`Native code changed since ${latest.tagName}, so no installed app could run this update. Release a new APK instead (README, Deploy).`);
  }

  console.log(`Publishing to installs of ${latest.tagName} (runtime ${runtime.slice(0, 12)}).`);
  // Set here, so the local .env with the development server can never end up in an update.
  const env = { ...process.env, EXPO_PUBLIC_API_URL: API_URL };
  run("npx", ["eas-cli", "update", "--channel", "preview", "--platform", "android", "--message", message, "--non-interactive"], false, env);
  console.log("Published. Installs switch to it on their next launch after downloading it.");
}
