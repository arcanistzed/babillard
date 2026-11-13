// Releases the Android app on babillard.app, after an EAS preview build of the version in
// app.config.ts has finished. Run from apps/mobile: node scripts/release-android.ts
//
// It refuses a version that isn't newer than the one already out, uploads the APK to R2,
// sets ANDROID_LATEST_VERSION in the API's wrangler.jsonc, and deploys. Installs older than
// that then offer the update. Last, it publishes the APK as a GitHub release, tagged on the
// commit it was built from, with notes from the changes since the previous release.
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
const commit = run("git", ["rev-parse", "HEAD"], mobileDir, true).trim();

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
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
const apk = join(dir, `babillard-${version}.apk`);
const download = await fetch(url);
if (!download.ok) fail(`Couldn't download the build: HTTP ${download.status}`);
writeFileSync(apk, Buffer.from(await download.arrayBuffer()));
run("npx", ["wrangler", "r2", "object", "put", "babillard/releases/babillard.apk", "--file", apk, "--remote"], apiDir);

const configPath = join(apiDir, "wrangler.jsonc");
const before = readFileSync(configPath, "utf8");
const after = before.replace(/("ANDROID_LATEST_VERSION":\s*)"[^"]*"/, `$1"${version}"`);
if (after === before) fail("Couldn't find ANDROID_LATEST_VERSION in apps/api/wrangler.jsonc.");
writeFileSync(configPath, after);

run("node", ["../site/scripts/build.ts"], apiDir);
run("npx", ["wrangler", "deploy"], apiDir);
console.log(`Released ${version} on babillard.app.`);

/** What people would notice, from the feat and fix commits since the last release. */
function releaseNotes(): string {
  const tags = run("git", ["tag", "--list", "v*", "--sort=-v:refname", "--merged", commit], mobileDir, true).split("\n").filter(Boolean);
  // Before the first tag, the previous version bump marks where the last release began.
  const since = tags[0] ?? run("git", ["log", "--format=%H", "--grep=^chore(mobile): version", "-n", "2", commit], mobileDir, true).split("\n").filter(Boolean)[1];
  const subjects = run("git", ["log", "--format=%s", since ? `${since}..${commit}` : commit], mobileDir, true).split("\n");
  const changes = subjects
    .map((subject) => /^(?:feat|fix)(?:\([^)]*\))?: (.+)$/.exec(subject)?.[1])
    .filter((change): change is string => Boolean(change))
    .map((change) => `- ${change.charAt(0).toUpperCase()}${change.slice(1)}`);
  return changes.length ? changes.join("\n") : "Maintenance release.";
}

// The website release has already happened, so a problem here only skips the GitHub copy.
try {
  run("git", ["fetch", "--quiet", "origin"], mobileDir);
  if (!run("git", ["branch", "--remotes", "--contains", commit], mobileDir, true).trim()) {
    console.warn(`Skipped the GitHub release: push ${commit.slice(0, 7)} first, then run gh release create v${version} by hand.`);
  } else {
    const notes = join(dir, "notes.md");
    writeFileSync(notes, `${releaseNotes()}\n\nAlso at https://babillard.app/download/android\n`);
    run("gh", ["release", "create", `v${version}`, apk, "--target", commit, "--title", version, "--notes-file", notes], mobileDir);
    console.log(`Published v${version} on GitHub.`);
  }
} catch {
  console.warn(`Couldn't publish v${version} on GitHub. The release on babillard.app is done.`);
}
console.log("Commit apps/api/wrangler.jsonc.");
