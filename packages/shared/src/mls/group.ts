import { sha256 } from "@noble/hashes/sha2.js";
import {
  acceptAll,
  createApplicationMessage,
  createCommit,
  createGroupInfoWithExternalPubAndRatchetTree,
  joinGroupExternal,
  createGroup,
  decodeGroupState,
  decodeMlsMessage,
  defaultCapabilities,
  defaultKeyPackageEqualityConfig,
  defaultKeyRetentionConfig,
  defaultLifetime,
  defaultLifetimeConfig,
  defaultPaddingConfig,
  emptyPskIndex,
  encodeGroupState,
  encodeMlsMessage,
  generateKeyPackage,
  generateKeyPackageWithKey,
  joinGroup,
  processMessage,
  type CiphersuiteImpl,
  type ClientConfig,
  type ClientState,
  type KeyPackage,
  type LeafNode,
  type PrivateKeyPackage,
  type Proposal,
} from "ts-mls";
import { toBase64 } from "../e2ee";

/**
 * The few MLS operations a Babillard chat needs, over ts-mls. Everything that
 * crosses the network is the standard MLS wire format (RFC 9420 section 6), so
 * another implementation could replace this file without a protocol change.
 *
 * Prototype only: nothing in the app calls this outside the flagged dev screen.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One phone's MLS identity. The private parts belong in SecureStore. */
export interface MlsDevice {
  userId: string;
  deviceId: string;
  keyPackage: KeyPackage;
  privatePackage: PrivateKeyPackage;
}

/**
 * Says whether a credential is really this user's phone. The phone fills it from
 * the server's device list, and people confirm that list by comparing security
 * codes. ts-mls's default accepts every credential, so never fall back to it.
 */
export type CredentialCheck = (identity: { userId: string; deviceId: string }, signaturePublicKey: Uint8Array) => boolean;

export function clientConfig(check: CredentialCheck): ClientConfig {
  return {
    keyRetentionConfig: defaultKeyRetentionConfig,
    lifetimeConfig: defaultLifetimeConfig,
    keyPackageEqualityConfig: defaultKeyPackageEqualityConfig,
    paddingConfig: defaultPaddingConfig,
    authService: {
      async validateCredential(credential, signaturePublicKey) {
        const identity = credential.credentialType === "basic" ? parseIdentity(credential.identity) : null;
        return identity !== null && check(identity, signaturePublicKey);
      },
    },
  };
}

function parseIdentity(bytes: Uint8Array): { userId: string; deviceId: string } | null {
  const [userId, deviceId, extra] = decoder.decode(bytes).split("/");
  return userId && deviceId && extra === undefined ? { userId, deviceId } : null;
}

export async function createDevice(userId: string, deviceId: string, cs: CiphersuiteImpl): Promise<MlsDevice> {
  const credential = { credentialType: "basic" as const, identity: encoder.encode(`${userId}/${deviceId}`) };
  const { publicPackage, privatePackage } = await generateKeyPackage(credential, defaultCapabilities(), defaultLifetime, [], cs);
  return { userId, deviceId, keyPackage: publicPackage, privatePackage };
}

/** What a phone uploads so others can add it. Each one is single-use. */
export function encodeKeyPackage(device: MlsDevice): Uint8Array {
  return encodeMlsMessage({ version: "mls10", wireformat: "mls_key_package", keyPackage: device.keyPackage });
}

function decodeKeyPackage(bytes: Uint8Array): KeyPackage {
  const message = decodeMlsMessage(bytes, 0)?.[0];
  if (message?.wireformat !== "mls_key_package") throw new Error("Not a key package");
  return message.keyPackage;
}

export async function startGroup(conversationId: string, device: MlsDevice, cs: CiphersuiteImpl, config: ClientConfig): Promise<ClientState> {
  return createGroup(encoder.encode(conversationId), device.keyPackage, device.privatePackage, [], cs, config);
}

export interface CommitOutput {
  state: ClientState;
  /** A PublicMessage, so the server can read its epoch and order it. */
  commit: Uint8Array;
  welcome?: Uint8Array;
  /** The new epoch's GroupInfo, with the ratchet tree. The server requires it with every commit. */
  groupInfo: Uint8Array;
}

/** The GroupInfo a phone needs to join this group on its own. */
async function groupInfoOf(state: ClientState, cs: CiphersuiteImpl): Promise<Uint8Array> {
  const groupInfo = await createGroupInfoWithExternalPubAndRatchetTree(state, [], cs);
  return encodeMlsMessage({ version: "mls10", wireformat: "mls_group_info", groupInfo });
}

async function commit(state: ClientState, proposals: Proposal[], cs: CiphersuiteImpl): Promise<CommitOutput> {
  const result = await createCommit({ state, cipherSuite: cs }, { extraProposals: proposals, ratchetTreeExtension: true, wireAsPublicMessage: true });
  return {
    state: result.newState,
    commit: encodeMlsMessage(result.commit),
    ...(result.welcome ? { welcome: encodeMlsMessage({ version: "mls10", wireformat: "mls_welcome", welcome: result.welcome }) } : {}),
    groupInfo: await groupInfoOf(result.newState, cs),
  };
}

/** Joins from the server's latest GroupInfo with an external commit, with nobody else's help. */
export async function joinExternally(groupInfo: Uint8Array, device: MlsDevice, cs: CiphersuiteImpl, config: ClientConfig): Promise<CommitOutput> {
  const message = decodeMlsMessage(groupInfo, 0)?.[0];
  if (message?.wireformat !== "mls_group_info") throw new Error("Not a group info");
  const result = await joinGroupExternal(message.groupInfo, device.keyPackage, device.privatePackage, false, cs, undefined, config);
  return {
    state: result.newState,
    commit: encodeMlsMessage({ version: "mls10", wireformat: "mls_public_message", publicMessage: result.publicMessage }),
    groupInfo: await groupInfoOf(result.newState, cs),
  };
}

/** Adds phones. Their owners join from the Welcome. Others apply the commit. */
export async function addDevices(state: ClientState, keyPackages: Uint8Array[], cs: CiphersuiteImpl): Promise<CommitOutput> {
  return commit(state, keyPackages.map((bytes) => ({ proposalType: "add", add: { keyPackage: decodeKeyPackage(bytes) } })), cs);
}

/** Removes every phone a person has, for a leave, a block, or a ban. */
export async function removeUser(state: ClientState, userId: string, cs: CiphersuiteImpl): Promise<CommitOutput> {
  const leaves = roster(state).filter((member) => member.userId === userId);
  if (!leaves.length) throw new Error("Not in this group");
  return commit(state, leaves.map((member) => ({ proposalType: "remove", remove: { removed: member.leafIndex } })), cs);
}

/** Removes the phones at these leaves. */
export async function removeLeaves(state: ClientState, leafIndexes: number[], cs: CiphersuiteImpl): Promise<CommitOutput> {
  return commit(state, leafIndexes.map((removed) => ({ proposalType: "remove", remove: { removed } })), cs);
}

/** Another key package under the same identity and signing key. */
export async function anotherKeyPackage(device: MlsDevice, cs: CiphersuiteImpl): Promise<MlsDevice> {
  const credential = { credentialType: "basic" as const, identity: encoder.encode(`${device.userId}/${device.deviceId}`) };
  const signatureKeyPair = { signKey: device.privatePackage.signaturePrivateKey, publicKey: device.keyPackage.leafNode.signaturePublicKey };
  const { publicPackage, privatePackage } = await generateKeyPackageWithKey(credential, defaultCapabilities(), defaultLifetime, [], signatureKeyPair, cs);
  return { ...device, keyPackage: publicPackage, privatePackage };
}

export async function joinFromWelcome(welcome: Uint8Array, device: MlsDevice, cs: CiphersuiteImpl, config: ClientConfig): Promise<ClientState> {
  const message = decodeMlsMessage(welcome, 0)?.[0];
  if (message?.wireformat !== "mls_welcome") throw new Error("Not a welcome");
  return joinGroup(message.welcome, device.keyPackage, device.privatePackage, emptyPskIndex, cs, undefined, undefined, config);
}

export async function encryptText(state: ClientState, text: string, cs: CiphersuiteImpl): Promise<{ state: ClientState; message: Uint8Array }> {
  const result = await createApplicationMessage(state, encoder.encode(text), cs);
  return { state: result.newState, message: encodeMlsMessage({ version: "mls10", wireformat: "mls_private_message", privateMessage: result.privateMessage }) };
}

export type Received = { state: ClientState; kind: "text"; text: string } | { state: ClientState; kind: "commit" };

/**
 * Applies one message from the chat's log, in order. Each message decrypts once:
 * MLS deletes the key afterwards, so the app must keep the text it gets back.
 */
export async function receive(state: ClientState, bytes: Uint8Array, cs: CiphersuiteImpl): Promise<Received> {
  const message = decodeMlsMessage(bytes, 0)?.[0];
  if (message?.wireformat !== "mls_private_message" && message?.wireformat !== "mls_public_message") throw new Error("Not a group message");
  const result = await processMessage(message, state, emptyPskIndex, acceptAll, cs);
  if (result.kind === "applicationMessage") return { state: result.newState, kind: "text", text: decoder.decode(result.message) };
  return { state: result.newState, kind: "commit" };
}

/** Group state for SecureStore or an encrypted file. It holds private keys. */
export function saveState(state: ClientState): Uint8Array {
  return encodeGroupState(state);
}

export function loadState(bytes: Uint8Array, config: ClientConfig): ClientState {
  const decoded = decodeGroupState(bytes, 0)?.[0];
  if (!decoded) throw new Error("Bad group state");
  return { ...decoded, clientConfig: config };
}

export interface RosterEntry {
  leafIndex: number;
  userId: string;
  deviceId: string;
  signatureKey: string;
}

export function roster(state: ClientState): RosterEntry[] {
  const entries: RosterEntry[] = [];
  state.ratchetTree.forEach((node, index) => {
    if (node?.nodeType !== "leaf") return;
    const leaf: LeafNode = node.leaf;
    const identity = leaf.credential.credentialType === "basic" ? parseIdentity(leaf.credential.identity) : null;
    if (identity) entries.push({ leafIndex: index / 2, ...identity, signatureKey: toBase64(leaf.signaturePublicKey) });
  });
  return entries;
}

/**
 * The code people compare in person. It covers who is in the group and which
 * signing keys they use, so it stays the same from one epoch to the next and
 * changes only when a phone joins or leaves.
 */
export function rosterCode(state: ClientState): string {
  return codeForRoster(roster(state));
}

/** The same code from any MLS library's roster. `signatureKey` is base64url, as `toBase64` writes it. */
export function codeForRoster(members: { userId: string; deviceId: string; signatureKey: string }[]): string {
  const lines = members.map((member) => `${member.userId}/${member.deviceId}/${member.signatureKey}`).sort();
  const digest = sha256(encoder.encode(["babillard/mls/code", ...lines].join("\n")));
  const groups: string[] = [];
  for (let i = 0; i < 12; i += 3) {
    const value = ((digest[i]! << 16) | (digest[i + 1]! << 8) | digest[i + 2]!) % 100000;
    groups.push(String(value).padStart(5, "0"));
  }
  return groups.join(" ");
}

export interface Frame {
  groupId: string;
  epoch: number;
  kind: "commit" | "proposal" | "application";
}

/**
 * Reads the unencrypted header of a group message. The server uses this to
 * order commits without any keys. Returns null for anything that isn't one.
 */
export function readFrame(bytes: Uint8Array): Frame | null {
  try {
    const decoded = decodeMlsMessage(bytes, 0);
    if (!decoded || decoded[1] !== bytes.length) return null;
    const message = decoded[0];
    if (message.wireformat === "mls_public_message") {
      const { groupId, epoch, contentType } = message.publicMessage.content;
      return { groupId: decoder.decode(groupId), epoch: Number(epoch), kind: contentType };
    }
    if (message.wireformat === "mls_private_message") {
      const { groupId, epoch, contentType } = message.privateMessage;
      return { groupId: decoder.decode(groupId), epoch: Number(epoch), kind: contentType };
    }
    return null;
  } catch {
    return null;
  }
}
