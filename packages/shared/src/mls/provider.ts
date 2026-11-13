import { CipherSuite } from "@hpke/core";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { Dhkem, HkdfSha256Native } from "@hpke/common";
import { X25519 } from "@hpke/dhkem-x25519";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { expand, extract } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { CiphersuiteImpl, CiphersuiteName, Hpke, PrivateKey, PublicKey } from "ts-mls";

/**
 * MLS cipher suite 3 (X25519, ChaCha20-Poly1305, SHA-256, Ed25519) for phones.
 *
 * ts-mls's own providers reach for WebCrypto: `@hpke/core` does X25519 and HMAC
 * through `crypto.subtle`, and its Ed25519 prefers it when present. Hermes has no
 * `crypto.subtle`, so this provider swaps each of those for `@noble`, the same
 * audited code the v1 envelopes use. Only `crypto.getRandomValues` must exist,
 * which the app supplies from expo-crypto.
 *
 * What's still `@hpke/*` code: the HPKE key schedule (RFC 9180) and the pure-JS
 * X25519 KEM from `@hpke/dhkem-x25519`. The tests run it against ts-mls's
 * WebCrypto provider to check that both produce the same protocol.
 */
export const MLS_CIPHERSUITE: CiphersuiteName = "MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519";

type Random = (length: number) => Uint8Array;

const copy = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

/** HKDF-SHA256 for HPKE, with the WebCrypto HMAC calls replaced. Labelling stays in `@hpke/common`. */
class NobleHkdfSha256 extends HkdfSha256Native {
  override async extract(salt: ArrayBuffer, ikm: ArrayBuffer): Promise<ArrayBuffer> {
    // An empty salt means a block of zeros (RFC 5869), and HMAC pads a short key with zeros anyway.
    return copy(extract(sha256, new Uint8Array(ikm), new Uint8Array(salt)));
  }

  override async expand(prk: ArrayBuffer, info: ArrayBuffer, length: number): Promise<ArrayBuffer> {
    return copy(expand(sha256, new Uint8Array(prk), new Uint8Array(info), length));
  }

  override async extractAndExpand(salt: ArrayBuffer, ikm: ArrayBuffer, info: ArrayBuffer, length: number): Promise<ArrayBuffer> {
    return this.expand(await this.extract(salt, ikm), info, length);
  }
}

/** DHKEM(X25519, HKDF-SHA256), built like `@hpke/dhkem-x25519`'s but on the HKDF above. */
class NobleDhkemX25519 extends Dhkem {
  override readonly id = 0x0020;
  override readonly secretSize = 32;
  override readonly encSize = 32;
  override readonly publicKeySize = 32;
  override readonly privateKeySize = 32;

  constructor() {
    const kdf = new NobleHkdfSha256();
    super(0x0020, new X25519(kdf), kdf);
  }
}

const asBuffer = (bytes: Uint8Array | undefined): ArrayBuffer => (bytes ? copy(bytes) : new ArrayBuffer(0));

/** Adapts an `@hpke/core` suite to ts-mls's Hpke interface. Follows ts-mls's own `makeGenericHpke` (MIT). */
function makeHpke(): Hpke {
  const suite = new CipherSuite({ kem: new NobleDhkemX25519(), kdf: new NobleHkdfSha256(), aead: new Chacha20Poly1305() });
  return {
    async open(privateKey, kemOutput, ciphertext, info, aad) {
      return new Uint8Array(await suite.open({ recipientKey: privateKey, enc: asBuffer(kemOutput), info: asBuffer(info) }, asBuffer(ciphertext), asBuffer(aad)));
    },
    async seal(publicKey, plaintext, info, aad) {
      const result = await suite.seal({ recipientPublicKey: publicKey, info: asBuffer(info) }, asBuffer(plaintext), asBuffer(aad));
      return { ct: new Uint8Array(result.ct), enc: new Uint8Array(result.enc) };
    },
    async exportSecret(publicKey, exporterContext, length, info) {
      const context = await suite.createSenderContext({ recipientPublicKey: publicKey, info: asBuffer(info) });
      return { enc: new Uint8Array(context.enc), secret: new Uint8Array(await context.export(asBuffer(exporterContext), length)) };
    },
    async importSecret(privateKey, exporterContext, kemOutput, length, info) {
      const context = await suite.createRecipientContext({ recipientKey: privateKey, info: asBuffer(info), enc: asBuffer(kemOutput) });
      return new Uint8Array(await context.export(asBuffer(exporterContext), length));
    },
    async importPrivateKey(key) {
      return (await suite.kem.deserializePrivateKey(asBuffer(key))) as PrivateKey;
    },
    async importPublicKey(key) {
      return (await suite.kem.deserializePublicKey(asBuffer(key))) as PublicKey;
    },
    async exportPublicKey(key) {
      return new Uint8Array(await suite.kem.serializePublicKey(key));
    },
    async exportPrivateKey(key) {
      return new Uint8Array(await suite.kem.serializePrivateKey(key));
    },
    async encryptAead(key, nonce, aad, plaintext) {
      return chacha20poly1305(key, nonce, aad ?? new Uint8Array()).encrypt(plaintext);
    },
    async decryptAead(key, nonce, aad, ciphertext) {
      return chacha20poly1305(key, nonce, aad ?? new Uint8Array()).decrypt(ciphertext);
    },
    async deriveKeyPair(ikm) {
      const pair = await suite.kem.deriveKeyPair(asBuffer(ikm));
      return { privateKey: pair.privateKey as PrivateKey, publicKey: pair.publicKey as PublicKey };
    },
    async generateKeyPair() {
      const pair = await suite.kem.generateKeyPair();
      return { privateKey: pair.privateKey as PrivateKey, publicKey: pair.publicKey as PublicKey };
    },
    keyLength: suite.aead.keySize,
    nonceLength: suite.aead.nonceSize,
  };
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

/** The cipher suite every Babillard MLS group uses. `random` is expo-crypto on the phone. */
export function mlsCiphersuite(random: Random): CiphersuiteImpl {
  return {
    name: MLS_CIPHERSUITE,
    rng: { randomBytes: random },
    kdf: {
      size: 32,
      extract: async (salt, ikm) => extract(sha256, ikm, salt),
      expand: async (prk, info, length) => expand(sha256, prk, info, length),
    },
    hash: {
      digest: async (data) => sha256(data),
      mac: async (key, data) => hmac(sha256, key, data),
      verifyMac: async (key, mac, data) => constantTimeEqual(mac, hmac(sha256, key, data)),
    },
    signature: {
      sign: async (signKey, message) => ed25519.sign(message, signKey),
      verify: async (publicKey, message, signature) => {
        try {
          return ed25519.verify(signature, message, publicKey);
        } catch {
          return false;
        }
      },
      keygen: async () => {
        const signKey = random(32);
        return { signKey, publicKey: ed25519.getPublicKey(signKey) };
      },
    },
    hpke: makeHpke(),
  };
}
