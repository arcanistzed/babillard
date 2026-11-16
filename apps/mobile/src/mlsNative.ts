import { toBase64 } from "@babillard/shared";
import * as Crypto from "expo-crypto";
import * as Mls from "../modules/babillard-mls";

export const nativeMlsAvailable = Mls.isAvailable;

export interface NativeDemoResult {
  steps: { label: string; ms: number }[];
  bobInbox: string[];
  aliceInbox: string[];
  carolInbox: string[];
  codes: { alice: string; bob: string; carol: string };
  stateBytes: number;
  serverEpoch: number;
}

const ROOM = "demo-chat";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Alice and Bob run OpenMLS through the native module. Every message goes
 * through the server's ordering check, which reads the header in plain
 * TypeScript. Then Carol joins on ts-mls, to check that the two libraries
 * speak the same protocol.
 */
export async function runNativeDemo(now: () => number = () => performance.now()): Promise<NativeDemoResult> {
  // The ts-mls side needs crypto.getRandomValues, which runDemo patches in. Do the same here.
  const scope = globalThis as { crypto?: { getRandomValues?: unknown } };
  if (typeof scope.crypto?.getRandomValues !== "function") {
    scope.crypto = { ...scope.crypto, getRandomValues: <T extends ArrayBufferView | null>(array: T): T => Crypto.getRandomValues(array as never) as T };
  }
  const shared = await import("@babillard/shared/mls");

  const steps: { label: string; ms: number }[] = [];
  async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
    const start = now();
    const value = await run();
    steps.push({ label, ms: Math.round(now() - start) });
    return value;
  }

  let serverEpoch = 0;
  function submit(bytes: Uint8Array): void {
    const result = shared.admit(ROOM, serverEpoch, bytes);
    if (!result.ok) throw new Error(`Server refused: ${result.error}`);
    serverEpoch = result.nextEpoch;
  }

  const [alice, bob] = await step("Create Alice's and Bob's identities (OpenMLS)", () =>
    Promise.all([Mls.createIdentity("alice", "alice-phone"), Mls.createIdentity("bob", "bob-phone")]),
  );
  const trusted: Mls.TrustedDevice[] = [
    { userId: "alice", deviceId: "alice-phone", signatureKey: alice.signatureKey },
    { userId: "bob", deviceId: "bob-phone", signatureKey: bob.signatureKey },
  ];

  let aliceState = await step("Alice starts the group", () => Mls.createGroup(alice.state, ROOM));
  const added = await step("Alice adds Bob (commit and Welcome)", () => Mls.addMembers(aliceState, ROOM, [bob.keyPackage], trusted));
  submit(added.commit);
  aliceState = added.state;
  let bobState = (await step("Bob joins from the Welcome", () => Mls.joinFromWelcome(bob.state, added.welcome!, trusted))).state;

  const bobInbox: string[] = [];
  const aliceInbox: string[] = [];
  async function deliver(state: Uint8Array, message: Uint8Array, inbox: string[], trust = trusted): Promise<Uint8Array> {
    const received = await Mls.receive(state, ROOM, message, trust);
    if (received.kind === "application") inbox.push(decoder.decode(received.plaintext));
    return received.state;
  }

  const hello = await step("Alice sends", () => Mls.encrypt(aliceState, ROOM, encoder.encode("Hi Bob, see you Thursday?")));
  submit(hello.message);
  aliceState = hello.state;
  bobState = await step("Bob reads", () => deliver(bobState, hello.message, bobInbox));

  const reply = await step("Bob replies", () => Mls.encrypt(bobState, ROOM, encoder.encode("Yes, at the library.")));
  submit(reply.message);
  bobState = reply.state;
  aliceState = await step("Alice reads", () => deliver(aliceState, reply.message, aliceInbox));

  // Carol runs ts-mls. OpenMLS adds her, and everyone must agree from then on.
  const cs = shared.mlsCiphersuite((length) => Crypto.getRandomBytes(length));
  const carol = await shared.createDevice("carol", "carol-phone", cs);
  const carolKey = carol.keyPackage.leafNode.signaturePublicKey;
  const everyone = [...trusted, { userId: "carol", deviceId: "carol-phone", signatureKey: carolKey }];
  const directory = new shared.DemoDirectory();
  for (const device of everyone) directory.keys.set(`${device.userId}/${device.deviceId}`, toBase64(device.signatureKey));

  const withCarol = await step("Alice adds Carol, who runs ts-mls", () => Mls.addMembers(aliceState, ROOM, [shared.encodeKeyPackage(carol)], everyone));
  submit(withCarol.commit);
  aliceState = withCarol.state;
  bobState = await deliver(bobState, withCarol.commit, bobInbox, everyone);
  let carolState = await step("Carol joins on ts-mls", () => shared.joinFromWelcome(withCarol.welcome!, carol, cs, directory.config()));

  const toCarol = await Mls.encrypt(aliceState, ROOM, encoder.encode("Welcome, Carol."));
  submit(toCarol.message);
  aliceState = toCarol.state;
  bobState = await deliver(bobState, toCarol.message, bobInbox, everyone);
  const carolInbox: string[] = [];
  const opened = await step("Carol reads OpenMLS's message", () => shared.receive(carolState, toCarol.message, cs));
  carolState = opened.state;
  if (opened.kind === "text") carolInbox.push(opened.text);

  const fromCarol = await shared.encryptText(carolState, "Thanks, both.", cs);
  submit(fromCarol.message);
  carolState = fromCarol.state;
  aliceState = await step("Alice reads Carol's ts-mls message", () => deliver(aliceState, fromCarol.message, aliceInbox, everyone));
  bobState = await deliver(bobState, fromCarol.message, bobInbox, everyone);

  const codeOf = async (state: Uint8Array) =>
    shared.codeForRoster((await Mls.groupStatus(state, ROOM)).roster.map((entry) => ({ ...entry, signatureKey: toBase64(entry.signatureKey) })));
  return {
    steps,
    bobInbox,
    aliceInbox,
    carolInbox,
    codes: { alice: await codeOf(aliceState), bob: await codeOf(bobState), carol: shared.rosterCode(carolState) },
    stateBytes: aliceState.length,
    serverEpoch,
  };
}
