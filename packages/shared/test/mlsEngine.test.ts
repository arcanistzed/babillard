import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryMlsStore } from "../src/mlsClient";
import { recoveryPassed, runEngineDemo, runRecoveryDemo } from "../src/mlsEngineDemo";
import { tsMlsCrypto } from "../src/mls/adapter";
import { mlsCiphersuite } from "../src/mls/provider";

const random = (length: number) => webcrypto.getRandomValues(new Uint8Array(length));

describe("the sync engine against an in-memory server", () => {
  it("forms a group, delivers, and removes a departed phone before the next message", async () => {
    const result = await runEngineDemo(tsMlsCrypto(mlsCiphersuite(random)), async () => new MemoryMlsStore());
    expect(result.read).toEqual({ bob: ["Thursday at the library?"], carol: ["Thursday at the library?"], alice: ["Just the two of us"] });
    expect(result.rosterAfterLeave).toBe(2);
    expect(result.codes[0]).toMatch(/^\d{5} \d{5} \d{5} \d{5}$/);
    expect(result.codes[0]).toBe(result.codes[1]);
  });

  it("recovers from lost answers and an entry that won't apply, as the dev screen's demo does", async () => {
    const result = await runRecoveryDemo(tsMlsCrypto(mlsCiphersuite(random)), async () => new MemoryMlsStore());
    expect(result).toMatchObject({ pendingAfterDrop: 1, pendingAfterSettle: 0, carolRead: ["hi Carol"], lostMessageStatus: "sent", bobPhonesAfterRejoin: 1, bobReadAfterRejoin: ["can you read this?"] });
    expect(recoveryPassed(result)).toBe(true);
  });
});
