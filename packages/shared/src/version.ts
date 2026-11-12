/**
 * Android needs a whole-number build code on every APK and won't install a lower one over a
 * higher one. It comes from the version, so the version is the only number to change:
 * 0.2.0 is 200, 1.0.0 is 10000. Minor and patch stay under 100.
 */
export function versionCode(version: string): number {
  const match = /^(\d+)\.(\d{1,2})\.(\d{1,2})$/.exec(version.trim());
  if (!match) throw new Error(`Expected a version like 1.2.3, got "${version}"`);
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  return major * 10_000 + minor * 100 + patch;
}
