import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fromBase64, toBase64 } from "../src/e2ee";

const random = (length: number) => new Uint8Array(randomBytes(length));

describe("base64url", () => {
  it("matches Node's unpadded base64url both ways, at every length up to 70 and past one chunk", () => {
    const lengths = [...Array.from({ length: 71 }, (_, i) => i), 0x2000 * 3 - 1, 0x2000 * 3, 0x2000 * 3 + 1, 100_000];
    for (const length of lengths) {
      const bytes = random(length);
      const expected = Buffer.from(bytes).toString("base64url");
      expect(toBase64(bytes), `length ${length}`).toBe(expected);
      expect(fromBase64(expected), `length ${length}`).toEqual(bytes);
    }
    // Every byte value.
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(toBase64(all)).toBe(Buffer.from(all).toString("base64url"));
  });

  it("refuses anything outside the base64url alphabet", () => {
    for (const text of ["ab+c", "ab/c", "abc=", "ab c", "é", "😀", "ab\u0000"]) expect(() => fromBase64(text), text).toThrow("Invalid base64");
  });
});
