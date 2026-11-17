import { createApplicationMessage, encodeMlsMessage, type CiphersuiteImpl, type ClientState } from "ts-mls";
import { fromBase64, toBase64 } from "../e2ee";
import type { MlsCrypto, TrustedDevice } from "../mlsClient";
import {
  addDevices,
  anotherKeyPackage,
  clientConfig,
  createDevice,
  encodeKeyPackage,
  joinExternally,
  joinFromWelcome,
  receive,
  removeLeaves,
  roster,
  startGroup,
  type MlsDevice,
} from "./group";

/**
 * MlsCrypto over ts-mls, for tests in Node: the same engine the phone runs on
 * OpenMLS, driven here by a second, independent MLS implementation.
 *
 * ts-mls states are immutable values, so each state handed out is a handle to a
 * snapshot that never changes. Old bytes stay valid after any call, which is the
 * property the engine relies on to roll back a refused commit. Snapshots live in
 * memory, so this is for tests only.
 */

interface Snapshot {
  /** Every key package this identity has handed out, newest last. A Welcome may use any of them. */
  packages: MlsDevice[];
  groups: Map<string, ClientState>;
}

const decoder = new TextDecoder();

export function tsMlsCrypto(cs: CiphersuiteImpl): MlsCrypto {
  const snapshots = new Map<string, Snapshot>();
  let next = 0;

  const save = (snapshot: Snapshot): Uint8Array => {
    const handle = `ts-mls-snapshot-${next++}`;
    snapshots.set(handle, snapshot);
    return new TextEncoder().encode(handle);
  };
  const load = (state: Uint8Array): Snapshot => {
    const snapshot = snapshots.get(decoder.decode(state));
    if (!snapshot) throw new Error("Unknown state");
    return snapshot;
  };
  const withGroup = (snapshot: Snapshot, conversationId: string, group: ClientState): Uint8Array =>
    save({ packages: snapshot.packages, groups: new Map(snapshot.groups).set(conversationId, group) });
  const group = (snapshot: Snapshot, conversationId: string, trusted?: TrustedDevice[]): ClientState => {
    const found = snapshot.groups.get(conversationId);
    if (!found) throw new Error("No such group");
    return trusted ? { ...found, clientConfig: configFor(trusted) } : found;
  };
  const configFor = (trusted: TrustedDevice[]) =>
    clientConfig(({ userId, deviceId }, key) => trusted.some((t) => t.userId === userId && t.deviceId === deviceId && toBase64(t.signatureKey) === toBase64(key)));
  const identity = (snapshot: Snapshot) => snapshot.packages[0]!;
  const conversationOf = (state: ClientState) => decoder.decode(state.groupContext.groupId);

  return {
    async createIdentity(userId, deviceId) {
      const device = await createDevice(userId, deviceId, cs);
      return { state: save({ packages: [device], groups: new Map() }), keyPackage: encodeKeyPackage(device), signatureKey: device.keyPackage.leafNode.signaturePublicKey };
    },
    async createKeyPackage(state) {
      const snapshot = load(state);
      const device = await anotherKeyPackage(identity(snapshot), cs);
      return { state: save({ ...snapshot, packages: [...snapshot.packages, device] }), keyPackage: encodeKeyPackage(device) };
    },
    async createGroup(state, conversationId) {
      const snapshot = load(state);
      return withGroup(snapshot, conversationId, await startGroup(conversationId, identity(snapshot), cs, configFor([])));
    },
    async addMembers(state, conversationId, keyPackages, trusted) {
      const snapshot = load(state);
      const output = await addDevices(group(snapshot, conversationId, trusted), keyPackages, cs);
      return { ...output, state: withGroup(snapshot, conversationId, output.state) };
    },
    async removeLeaves(state, conversationId, leafIndexes) {
      const snapshot = load(state);
      const output = await removeLeaves(group(snapshot, conversationId), leafIndexes, cs);
      return { ...output, state: withGroup(snapshot, conversationId, output.state) };
    },
    async updateKeys(state, conversationId) {
      const snapshot = load(state);
      const output = await addDevices(group(snapshot, conversationId), [], cs);
      return { ...output, state: withGroup(snapshot, conversationId, output.state) };
    },
    async joinFromWelcome(state, welcome, trusted) {
      const snapshot = load(state);
      // The Welcome was made for whichever package was claimed. Try them all, newest first.
      for (const device of [...snapshot.packages].reverse()) {
        try {
          const joined = await joinFromWelcome(welcome, device, cs, configFor(trusted));
          return { state: withGroup(snapshot, conversationOf(joined), joined), conversationId: conversationOf(joined) };
        } catch (error) {
          if (String(error).includes("credential")) throw error;
        }
      }
      throw new Error("No key package matches this Welcome");
    },
    async forgetGroup(state, conversationId) {
      const snapshot = load(state);
      const groups = new Map(snapshot.groups);
      groups.delete(conversationId);
      return save({ packages: snapshot.packages, groups });
    },
    async joinExternal(state, groupInfo, trusted, rejoin) {
      const snapshot = load(state);
      const output = await joinExternally(groupInfo, identity(snapshot), cs, configFor(trusted), rejoin === true);
      const conversationId = conversationOf(output.state);
      return { ...output, state: withGroup(snapshot, conversationId, output.state), conversationId };
    },
    async encrypt(state, conversationId, plaintext, aad) {
      const snapshot = load(state);
      const result = await createApplicationMessage(group(snapshot, conversationId), plaintext, cs, aad);
      const message = encodeMlsMessage({ version: "mls10", wireformat: "mls_private_message", privateMessage: result.privateMessage });
      return { state: withGroup(snapshot, conversationId, result.newState), message };
    },
    async receive(state, conversationId, message, trusted) {
      const snapshot = load(state);
      const result = await receive(group(snapshot, conversationId, trusted), message, cs);
      const next = withGroup(snapshot, conversationId, result.state);
      if (result.kind === "text") return { kind: "application", state: next, plaintext: new TextEncoder().encode(result.text), aad: new Uint8Array() };
      const removedMe = !roster(result.state).some((entry) => entry.deviceId === identity(snapshot).deviceId);
      return { kind: "commit", state: next, removedMe };
    },
    async groupStatus(state, conversationId) {
      const found = load(state).groups.get(conversationId);
      if (!found) return null;
      return { epoch: Number(found.groupContext.epoch), roster: roster(found).map((entry) => ({ ...entry, signatureKey: fromBase64(entry.signatureKey) })) };
    },
  };
}
