/**
 * Reads the parts of MLS messages (RFC 9420) that the server needs, with no
 * cryptography and no MLS library. The server can't decrypt anything, but
 * commits travel as PublicMessages, so it can see who they add and remove and
 * keep its own copy of each group's roster.
 *
 * Every function throws `MlsWireError` on anything malformed or unexpected.
 * Callers treat that as a refusal, never as a reason to guess.
 */

export class MlsWireError extends Error {}

const decoder = new TextDecoder();

class Reader {
  offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset === this.bytes.length;
  }

  take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) throw new MlsWireError("truncated");
    const out = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  u8(): number {
    return this.take(1)[0]!;
  }

  u16(): number {
    const [a, b] = this.take(2);
    return (a! << 8) | b!;
  }

  u32(): number {
    const [a, b, c, d] = this.take(4);
    return ((a! << 24) >>> 0) + ((b! << 16) | (c! << 8) | d!);
  }

  /** Epochs fit easily in a JavaScript number. Anything past 2^53 is refused. */
  u64(): number {
    const high = this.u32();
    const low = this.u32();
    if (high > 0x1fffff) throw new MlsWireError("number too large");
    return high * 2 ** 32 + low;
  }

  /** The variable-length size prefix from RFC 9420 section 2.1.2: 1, 2, or 4 bytes, minimal encoding. */
  varint(): number {
    const first = this.u8();
    const prefix = first >> 6;
    if (prefix === 0) return first & 0x3f;
    if (prefix === 1) {
      const value = ((first & 0x3f) << 8) | this.u8();
      if (value < 64) throw new MlsWireError("non-minimal length");
      return value;
    }
    if (prefix === 2) {
      const rest = this.take(3);
      const value = ((first & 0x3f) * 2 ** 24) + ((rest[0]! << 16) | (rest[1]! << 8) | rest[2]!);
      if (value < 16384) throw new MlsWireError("non-minimal length");
      return value;
    }
    throw new MlsWireError("invalid length prefix");
  }

  /** A `<V>` vector of opaque bytes. */
  vector(): Uint8Array {
    return this.take(this.varint());
  }

  /** A `<V>` vector of structures, each read by `item` until the bytes run out. */
  list<T>(item: (reader: Reader) => T): T[] {
    const inner = new Reader(this.vector());
    const out: T[] = [];
    while (!inner.done) out.push(item(inner));
    return out;
  }

  optional<T>(item: (reader: Reader) => T): T | undefined {
    const present = this.u8();
    if (present === 0) return undefined;
    if (present === 1) return item(this);
    throw new MlsWireError("invalid optional");
  }
}

const VERSION_MLS10 = 1;
const WIRE = { public: 1, private: 2, welcome: 3, groupInfo: 4, keyPackage: 5 } as const;
const CONTENT = { 1: "application", 2: "proposal", 3: "commit" } as const;
const PROPOSAL = { add: 1, update: 2, remove: 3, externalInit: 6 } as const;

export interface Identity {
  /** The basic credential's identity, as text. Babillard uses `userId/deviceId`. */
  identity: string;
  signatureKey: Uint8Array;
}

export interface CommitSummary {
  /** Leaf indexes, as RFC 9420 numbers them. */
  removes: number[];
  adds: Identity[];
  /** The committer's new leaf, if the commit carries an update path. */
  pathLeaf?: Identity;
  /** How many ExternalInit proposals it has. An external commit, where a phone adds itself, has exactly one. */
  externalInits: number;
}

export type Frame =
  | {
      wireformat: "public";
      groupId: string;
      epoch: number;
      kind: "application" | "proposal" | "commit";
      sender: { type: "member"; leafIndex: number } | { type: "other"; senderType: number };
      commit?: CommitSummary;
    }
  | { wireformat: "private"; groupId: string; epoch: number; kind: "application" | "proposal" | "commit"; authenticatedData: Uint8Array };

function credential(reader: Reader): string {
  const type = reader.u16();
  if (type !== 1) throw new MlsWireError("only basic credentials are accepted");
  return decoder.decode(reader.vector());
}

function capabilities(reader: Reader): void {
  for (let i = 0; i < 5; i++) reader.vector(); // versions, cipher suites, extensions, proposals, credentials
}

function leafNode(reader: Reader): Identity {
  reader.vector(); // encryption key
  const signatureKey = reader.vector();
  const identity = credential(reader);
  capabilities(reader);
  const source = reader.u8();
  if (source === 1) reader.take(16); // lifetime: not_before, not_after
  else if (source === 3) reader.vector(); // parent hash
  else if (source !== 2) throw new MlsWireError("unknown leaf node source");
  reader.vector(); // extensions
  reader.vector(); // signature
  return { identity, signatureKey };
}

function keyPackageBody(reader: Reader): Identity & { cipherSuite: number } {
  if (reader.u16() !== VERSION_MLS10) throw new MlsWireError("unknown key package version");
  const cipherSuite = reader.u16();
  reader.vector(); // init key
  const leaf = leafNode(reader);
  reader.vector(); // extensions
  reader.vector(); // signature
  return { ...leaf, cipherSuite };
}

function proposal(reader: Reader, summary: CommitSummary): void {
  const type = reader.u16();
  if (type === PROPOSAL.add) summary.adds.push(keyPackageBody(reader));
  else if (type === PROPOSAL.remove) summary.removes.push(reader.u32());
  else if (type === PROPOSAL.externalInit) {
    reader.vector(); // KEM output
    summary.externalInits += 1;
  }
  // Babillard commits only add, remove, and join externally. Anything else, including updates by value, is refused.
  else throw new MlsWireError(`unsupported proposal type ${type}`);
}

function commit(reader: Reader): CommitSummary {
  const summary: CommitSummary = { removes: [], adds: [], externalInits: 0 };
  const inner = new Reader(reader.vector());
  while (!inner.done) {
    const kind = inner.u8();
    if (kind !== 1) throw new MlsWireError("proposals by reference are not accepted");
    proposal(inner, summary);
  }
  const path = reader.optional((r) => {
    const leaf = leafNode(r);
    r.vector(); // path nodes
    return leaf;
  });
  if (path) summary.pathLeaf = path;
  return summary;
}

function header(bytes: Uint8Array): { reader: Reader; wireformat: number } {
  const reader = new Reader(bytes);
  if (reader.u16() !== VERSION_MLS10) throw new MlsWireError("unknown MLS version");
  return { reader, wireformat: reader.u16() };
}

function finish(reader: Reader): void {
  if (!reader.done) throw new MlsWireError("trailing bytes");
}

function contentType(value: number): "application" | "proposal" | "commit" {
  const kind = CONTENT[value as keyof typeof CONTENT];
  if (!kind) throw new MlsWireError("unknown content type");
  return kind;
}

/** Reads a group message's unencrypted header, and for a public commit, what it adds and removes. */
export function readFrame(bytes: Uint8Array): Frame {
  const { reader, wireformat } = header(bytes);
  if (wireformat === WIRE.private) {
    const groupId = decoder.decode(reader.vector());
    const epoch = reader.u64();
    const kind = contentType(reader.u8());
    // In the clear, and bound to the message by its encryption: where a message's franking commitment goes.
    const authenticatedData = reader.vector().slice();
    reader.vector(); // encrypted sender data
    reader.vector(); // ciphertext
    finish(reader);
    return { wireformat: "private", groupId, epoch, kind, authenticatedData };
  }
  if (wireformat !== WIRE.public) throw new MlsWireError("not a group message");

  const groupId = decoder.decode(reader.vector());
  const epoch = reader.u64();
  const senderType = reader.u8();
  const sender = senderType === 1 ? { type: "member" as const, leafIndex: reader.u32() } : { type: "other" as const, senderType };
  if (senderType === 2) reader.u32(); // external sender index
  else if (senderType !== 1 && senderType !== 3 && senderType !== 4) throw new MlsWireError("unknown sender type");
  reader.vector(); // authenticated data
  const kind = contentType(reader.u8());

  let summary: CommitSummary | undefined;
  if (kind === "application") reader.vector();
  else if (kind === "proposal") throw new MlsWireError("lone proposals are not accepted");
  else summary = commit(reader);

  reader.vector(); // signature
  if (kind === "commit") reader.vector(); // confirmation tag
  if (senderType === 1) reader.vector(); // membership tag
  finish(reader);
  return { wireformat: "public", groupId, epoch, kind, sender, ...(summary ? { commit: summary } : {}) };
}

/** Reads a key package's credential and signing key, so the server can check whose it is before storing it. */
export function readKeyPackage(bytes: Uint8Array): Identity & { cipherSuite: number } {
  const { reader, wireformat } = header(bytes);
  if (wireformat !== WIRE.keyPackage) throw new MlsWireError("not a key package");
  const body = keyPackageBody(reader);
  finish(reader);
  return body;
}

/** Reads which group and epoch a GroupInfo is for. */
export function readGroupInfo(bytes: Uint8Array): { groupId: string; epoch: number } {
  const { reader, wireformat } = header(bytes);
  if (wireformat !== WIRE.groupInfo) throw new MlsWireError("not a group info");
  reader.u16(); // group context version
  const keyLength = HPKE_KEY_LENGTH[reader.u16()];
  if (keyLength === undefined) throw new MlsWireError("unsupported cipher suite");
  const groupId = decoder.decode(reader.vector());
  const epoch = reader.u64();
  reader.vector(); // tree hash
  reader.vector(); // confirmed transcript hash
  reader.vector(); // group context extensions
  // A phone joining or rejoining by itself needs the external_pub key. RFC 9420 section 12.4.3.2
  // makes it a length-prefixed key. ts-mls 1.6.4 wrote the bare key, which OpenMLS can't read.
  const extensions = new Reader(reader.vector());
  let externalPub = 0;
  while (!extensions.done) {
    const type = extensions.u16();
    const data = new Reader(extensions.vector());
    if (type !== EXTERNAL_PUB) continue;
    if (data.vector().length !== keyLength || !data.done) throw new MlsWireError("bad external_pub");
    externalPub += 1;
  }
  if (externalPub !== 1) throw new MlsWireError("needs one external_pub");
  reader.vector(); // confirmation tag
  reader.u32(); // signer
  reader.vector(); // signature
  if (!reader.done) throw new MlsWireError("trailing bytes");
  return { groupId, epoch };
}

const EXTERNAL_PUB = 4;
/** HPKE public key sizes for the X25519 cipher suites, the only ones Babillard uses. */
const HPKE_KEY_LENGTH: Record<number, number> = { 1: 32, 3: 32 };

/** Checks that bytes are a Welcome, without reading inside it. Its contents are encrypted to the new member. */
export function isWelcome(bytes: Uint8Array): boolean {
  try {
    const { reader, wireformat } = header(bytes);
    if (wireformat !== WIRE.welcome) return false;
    reader.u16(); // cipher suite
    reader.vector(); // secrets
    reader.vector(); // encrypted group info
    return reader.done;
  } catch {
    return false;
  }
}

/** The `userId/deviceId` pair Babillard puts in every credential, or null if it doesn't fit that shape. */
export function parseIdentity(identity: string): { userId: string; deviceId: string } | null {
  const parts = identity.split("/");
  return parts.length === 2 && parts[0] && parts[1] ? { userId: parts[0], deviceId: parts[1] } : null;
}
