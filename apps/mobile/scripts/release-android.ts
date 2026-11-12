// Releases the Android app on babillard.app, after an EAS preview build of the version in
// app.config.ts has finished. Run from apps/mobile: node scripts/release-android.ts
//
// It refuses a version that isn't newer than the one already out, uploads the APK to R2,
// sets ANDROID_LATEST_VERSION in the API's wrangler.jsonc, and deploys. Installs older than
// that then offer the update.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import config from "../app.config.ts";

const ORIGIN = "https://babillard.app";
const mobileDir = resolve(import.meta.dirname, "..");
const apiDir = resolve(mobileDir, "../api");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function run(command: string, args: string[], cwd: string, capture = false): string {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" }) ?? "";
}

const version = config.version;
const code = config.android?.versionCode;
if (!version || !code) fail("app.config.ts has no version.");

if (run("git", ["status", "--porcelain"], mobileDir, true).trim()) fail("Commit your changes first, so the deployed API matches the repository.");

// A version that's already out, or older, would never reach anyone.
const live = (await (await fetch(`${ORIGIN}/app/version`)).json()) as { android: { latest: number } };
if (code <= live.android.latest) {
  fail(`Version ${version} (build ${code}) isn't newer than build ${live.android.latest}, which is already out. Raise the version in app.config.ts and build again.`);
}

interface EasBuild {
  appVersion?: string;
  appBuildVersion?: string;
  artifacts?: { buildUrl?: string };
}
const builds = JSON.parse(
  run("npx", ["eas-cli", "build:list", "--platform", "android", "--build-profile", "preview", "--status", "finished", "--limit", "10", "--json"], mobileDir, true),
) as EasBuild[];
const url = builds.find((build) => build.appVersion === version && build.appBuildVersion === String(code))?.artifacts?.buildUrl;
if (!url) fail(`No finished preview build of ${version}. Build it first: npx eas-cli build --platform android --profile preview`);

console.log(`Uploading ${version} (build ${code}).`);
const dir = mkdtempSync(join(tmpdir(), "babillard-release-"));
try {
  const apk = join(dir, "babillard.apk");
  const download = await fetch(url);
  if (!download.ok) fail(`Couldn't download the build: HTTP ${download.status}`);
  writeFileSync(apk, Buffer.from(await download.arrayBuffer()));
  run("npx", ["wrangler", "r2", "object", "put", "babillard/releases/babillard.apk", "--file", apk, "--remote"], apiDir);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const configPath = join(apiDir, "wrangler.jsonc");
const before = readFileSync(configPath, "utf8");
const after = before.replace(/("ANDROID_LATEST_VERSION":\s*)"[^"]*"/, `$1"${version}"`);
if (after === before) fail("Couldn't find ANDROID_LATEST_VERSION in apps/api/wrangler.jsonc.");
writeFileSync(configPath, after);

run("node", ["../site/scripts/build.ts"], apiDir);
run("npx", ["wrangler", "deploy"], apiDir);
console.log(`Released ${version}. Commit apps/api/wrangler.jsonc.`);
