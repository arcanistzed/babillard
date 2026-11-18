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
  isReady(): boolean;
  createIdentity(userId: string, deviceId: string): Promise<Encoded<{ state: Uint8Array; keyPackage: Uint8Array; signatureKey: Uint8Array }>>;
  createKeyPackage(state: string): Promise<Encoded<{ state: Uint8Array; keyPackage: Uint8Array }>>;
  createLastResortKeyPackage(state: string): Promise<Encoded<{ state: Uint8Array; keyPackage: Uint8Array }>>;
  createGroup(state: string, groupId: string): Promise<string>;
  addMembers(state: string, groupId: string, keyPackages: string[], trusted: Encoded<TrustedDevice>[]): Promise<{ state: string; commit: string; welcome: string | null; groupInfo: string }>;
  removeUser(state: string, groupId: string, userId: string): Promise<{ state: string; commit: string; groupInfo: string }>;
  updateKeys(state: string, groupId: string): Promise<{ state: string; commit: string; groupInfo: string }>;
  removeLeaves(state: string, groupId: string, leafIndexes: number[]): Promise<{ state: string; commit: string; groupInfo: string }>;
  joinExternal(state: string, groupInfo: string, trusted: Encoded<TrustedDevice>[]): Promise<{ state: string; groupId: string; commit: string; groupInfo: string }>;
  forgetGroup(state: string, groupId: string): Promise<string>;
  joinFromWelcome(state: string, welcome: string, trusted: Encoded<TrustedDevice>[]): Promise<{ state: string; groupId: string; lastResort: boolean }>;
  encrypt(state: string, groupId: string, plaintext: string, aad: string): Promise<{ state: string; message: string }>;
  receive(state: string, groupId: string, message: string, trusted: Encoded<TrustedDevice>[]): Promise<Record<string, string | boolean>>;
  groupStatus(state: string, groupId: string): Promise<{ epoch: number; roster: { leafIndex: number; userId: string; deviceId: string; signatureKey: string }[] }>;
}

/** Null in Expo Go. */
const native = requireOptionalNativeModule<NativeModule>("BabillardMls");

/** True only if the module is in this build and its Rust library loaded. Until then, chats stay on v1. */
export const isAvailable = native !== null && native.isReady();

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

/** A key package the server can hand out again and again once the single-use ones run out. OpenMLS keeps its private key after a Welcome. */
export async function createLastResortKeyPackage(state: Uint8Array) {
  const result = await module().createLastResortKeyPackage(toBase64(state));
  return { state: fromBase64(result.state), keyPackage: fromBase64(result.keyPackage) };
}

export async function createGroup(state: Uint8Array, conversationId: string): Promise<Uint8Array> {
  return fromBase64(await module().createGroup(toBase64(state), toBase64(encoder.encode(conversationId))));
}

export async function addMembers(state: Uint8Array, conversationId: string, keyPackages: Uint8Array[], trusted: TrustedDevice[]) {
  const output = await module().addMembers(toBase64(state), toBase64(encoder.encode(conversationId)), keyPackages.map(toBase64), encodeTrusted(trusted));
  return {
    state: fromBase64(output.state),
    commit: fromBase64(output.commit),
    welcome: output.welcome === null ? undefined : fromBase64(output.welcome),
    groupInfo: fromBase64(output.groupInfo),
  };
}

export async function removeUser(state: Uint8Array, conversationId: string, userId: string) {
  const output = await module().removeUser(toBase64(state), toBase64(encoder.encode(conversationId)), userId);
  return { state: fromBase64(output.state), commit: fromBase64(output.commit), groupInfo: fromBase64(output.groupInfo) };
}

/** Removes the phones at these leaves, as the server lists them under pending removals. */
export async function removeLeaves(state: Uint8Array, conversationId: string, leafIndexes: number[]) {
  const output = await module().removeLeaves(toBase64(state), toBase64(encoder.encode(conversationId)), leafIndexes);
  return { state: fromBase64(output.state), commit: fromBase64(output.commit), groupInfo: fromBase64(output.groupInfo) };
}

export async function updateKeys(state: Uint8Array, conversationId: string) {
  const output = await module().updateKeys(toBase64(state), toBase64(encoder.encode(conversationId)));
  return { state: fromBase64(output.state), commit: fromBase64(output.commit), groupInfo: fromBase64(output.groupInfo) };
}

/** Drops this phone's copy of a chat's group, before rejoining it. */
export async function forgetGroup(state: Uint8Array, conversationId: string): Promise<Uint8Array> {
  return fromBase64(await module().forgetGroup(toBase64(state), toBase64(encoder.encode(conversationId))));
}

/** Joins a chat by itself from the server's latest GroupInfo. Submit `commit` with `groupInfo`, like any commit. */
export async function joinExternal(state: Uint8Array, groupInfo: Uint8Array, trusted: TrustedDevice[]) {
  const joined = await module().joinExternal(toBase64(state), toBase64(groupInfo), encodeTrusted(trusted));
  return {
    state: fromBase64(joined.state),
    conversationId: new TextDecoder().decode(fromBase64(joined.groupId)),
    commit: fromBase64(joined.commit),
    groupInfo: fromBase64(joined.groupInfo),
  };
}

export async function joinFromWelcome(state: Uint8Array, welcome: Uint8Array, trusted: TrustedDevice[]) {
  const joined = await module().joinFromWelcome(toBase64(state), toBase64(welcome), encodeTrusted(trusted));
  return { state: fromBase64(joined.state), conversationId: new TextDecoder().decode(fromBase64(joined.groupId)), lastResort: joined.lastResort === true };
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
