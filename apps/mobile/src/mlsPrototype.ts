import * as Crypto from "expo-crypto";

/** Off unless a development build sets EXPO_PUBLIC_MLS_PROTOTYPE=1. Never set it for a release. */
export const MLS_PROTOTYPE = process.env.EXPO_PUBLIC_MLS_PROTOTYPE === "1";

const random = (length: number) => Crypto.getRandomBytes(length);

/** What the phone's JavaScript engine offers, before anything is patched in. */
export function describeRuntime(): { hermes: boolean; getRandomValues: boolean; subtle: boolean } {
  const crypto = (globalThis as { crypto?: { getRandomValues?: unknown; subtle?: unknown } }).crypto;
  return {
    hermes: typeof (globalThis as { HermesInternal?: unknown }).HermesInternal === "object",
    getRandomValues: typeof crypto?.getRandomValues === "function",
    subtle: crypto?.subtle !== undefined,
  };
}

/** `@hpke/common` makes X25519 keys with crypto.getRandomValues, which Hermes may lack. expo-crypto fills it. */
function ensureGetRandomValues(): void {
  const scope = globalThis as { crypto?: { getRandomValues?: unknown } };
  if (typeof scope.crypto?.getRandomValues === "function") return;
  const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => Crypto.getRandomValues(array as never) as T;
  if (scope.crypto) scope.crypto.getRandomValues = getRandomValues;
  else scope.crypto = { getRandomValues };
}

export async function runDemo() {
  ensureGetRandomValues();
  // Runs only when the flag is on and someone presses Run. Metro still bundles it into every build.
  const { runTwoMemberDemo } = await import("@babillard/shared/mls");
  return runTwoMemberDemo(random, () => performance.now());
}
