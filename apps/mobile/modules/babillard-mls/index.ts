import { fromBase64, toBase64 } from "@babillard/shared";
import { requireOptionalNativeModule } from "expo";

/**
 * OpenMLS, through the Rust library in ./rust. Each call takes the phone's
 * MLS state and returns the new one. If a call throws, keep the old state:
 * nothing was applied. Save the new state in the same transaction as
 * whatever the call produced.
 */

export interface TrustedDevice {
  userId: string;
  deviceId: string;
  signatureKey: Uint8Array;
}

export type Received =
  | { kind: "application"; state: Uint8Array; plaintext: Uint8Array; aad: Uint8Array; senderUserId: string; senderDeviceId: string }
  | { kind: "commit"; state: Uint8Array; removedMe: boolean };

export interface GroupStatus {
  epoch: number;
  roster: { leafIndex: number; userId: string; deviceId: string; signatureKey: Uint8Array }[];
}

type Encoded<T> = { [K in keyof T]: T[K] extends Uint8Array ? string : T[K] extends Uint8Array | undefined ? string | null : T[K] };

interface NativeModule {
  createIdentity(userId: string, deviceId: string): Promise<Encoded<{ state: Uint8Array; keyPackage: Uint8Array; signatureKey: Uint8Array }>>;
  createKeyPackage(state: string): Promise<Encoded<{ state: Uint8Array; keyPackage: Uint8Array }>>;
  createGroup(state: string, groupId: string): Promise<string>;
  addMembers(state: string, groupId: string, keyPackages: string[], trusted: Encoded<TrustedDevice>[]): Promise<{ state: string; commit: string; welcome: string | null }>;
  removeUser(state: string, groupId: string, userId: string): Promise<{ state: string; commit: string }>;
  updateKeys(state: string, groupId: string): Promise<{ state: string; commit: string }>;
  joinFromWelcome(state: string, welcome: string, trusted: Encoded<TrustedDevice>[]): Promise<{ state: string; groupId: string }>;
  encrypt(state: string, groupId: string, plaintext: string, aad: string): Promise<{ state: string; message: string }>;
  receive(state: string, groupId: string, message: string, trusted: Encoded<TrustedDevice>[]): Promise<Record<string, string | boolean>>;
  groupStatus(state: string, groupId: string): Promise<{ epoch: number; roster: { leafIndex: number; userId: string; deviceId: string; signatureKey: string }[] }>;
}

/** Null in Expo Go and on platforms the Rust library isn't built for. */
const native = requireOptionalNativeModule<NativeModule>("BabillardMls");

export const isAvailable = native !== null;

function module(): NativeModule {
  if (!native) throw new Error("The BabillardMls native module isn't in this build");
  return native;
}

const encoder = new TextEncoder();
const encodeTrusted = (devices: TrustedDevice[]) => devices.map((device) => ({ ...device, signatureKey: toBase64(device.signatureKey) }));

export async function createIdentity(userId: string, deviceId: string) {
  const identity = await module().createIdentity(userId, deviceId);
  return { state: fromBase64(identity.state), keyPackage: fromBase64(identity.keyPackage), signatureKey: fromBase64(identity.signatureKey) };
}

export async function createKeyPackage(state: Uint8Array) {
  const result = await module().createKeyPackage(toBase64(state));
  return { state: fromBase64(result.state), keyPackage: fromBase64(result.keyPackage) };
}

export async function createGroup(state: Uint8Array, conversationId: string): Promise<Uint8Array> {
  return fromBase64(await module().createGroup(toBase64(state), toBase64(encoder.encode(conversationId))));
}

export async function addMembers(state: Uint8Array, conversationId: string, keyPackages: Uint8Array[], trusted: TrustedDevice[]) {
  const output = await module().addMembers(toBase64(state), toBase64(encoder.encode(conversationId)), keyPackages.map(toBase64), encodeTrusted(trusted));
  return { state: fromBase64(output.state), commit: fromBase64(output.commit), welcome: output.welcome === null ? undefined : fromBase64(output.welcome) };
}

export async function removeUser(state: Uint8Array, conversationId: string, userId: string) {
  const output = await module().removeUser(toBase64(state), toBase64(encoder.encode(conversationId)), userId);
  return { state: fromBase64(output.state), commit: fromBase64(output.commit) };
}

export async function updateKeys(state: Uint8Array, conversationId: string) {
  const output = await module().updateKeys(toBase64(state), toBase64(encoder.encode(conversationId)));
  return { state: fromBase64(output.state), commit: fromBase64(output.commit) };
}

export async function joinFromWelcome(state: Uint8Array, welcome: Uint8Array, trusted: TrustedDevice[]) {
  const joined = await module().joinFromWelcome(toBase64(state), toBase64(welcome), encodeTrusted(trusted));
  return { state: fromBase64(joined.state), conversationId: new TextDecoder().decode(fromBase64(joined.groupId)) };
}

export async function encrypt(state: Uint8Array, conversationId: string, plaintext: Uint8Array, aad: Uint8Array = new Uint8Array()) {
  const sent = await module().encrypt(toBase64(state), toBase64(encoder.encode(conversationId)), toBase64(plaintext), toBase64(aad));
  return { state: fromBase64(sent.state), message: fromBase64(sent.message) };
}

export async function receive(state: Uint8Array, conversationId: string, message: Uint8Array, trusted: TrustedDevice[]): Promise<Received> {
  const result = await module().receive(toBase64(state), toBase64(encoder.encode(conversationId)), toBase64(message), encodeTrusted(trusted));
  if (result.kind === "commit") return { kind: "commit", state: fromBase64(result.state as string), removedMe: result.removedMe === true };
  return {
    kind: "application",
    state: fromBase64(result.state as string),
    plaintext: fromBase64(result.plaintext as string),
    aad: fromBase64(result.aad as string),
    senderUserId: result.senderUserId as string,
    senderDeviceId: result.senderDeviceId as string,
  };
}

export async function groupStatus(state: Uint8Array, conversationId: string): Promise<GroupStatus> {
  const status = await module().groupStatus(toBase64(state), toBase64(encoder.encode(conversationId)));
  return { epoch: status.epoch, roster: status.roster.map((entry) => ({ ...entry, signatureKey: fromBase64(entry.signatureKey) })) };
}
