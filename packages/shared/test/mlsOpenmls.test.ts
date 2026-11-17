import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toBase64 } from "../src/e2ee";
import { decide, type Directory, type RosterEntry } from "../src/mlsDelivery";
import { isWelcome, readFrame, readKeyPackage } from "../src/mlsWire";

/**
 * Real OpenMLS output, written by the Rust test `server_fixture` in
 * apps/mobile/modules/babillard-mls. Regenerate with:
 *   BABILLARD_MLS_FIXTURE=$PWD/packages/shared/test/fixtures/openmls.json cargo test server_fixture
 * (run from that crate's rust/ directory, with the path made absolute).
 */
interface Fixture {
  groupId: string;
  devices: { userId: string; deviceId: string; signatureKey: string; keyPackage: string }[];
  steps: { sender: string; epoch: number; kind: string; message: string; welcome?: string; roster: RosterEntry[] }[];
}

const fixture = JSON.parse(readFileSync(new URL("./fixtures/openmls.json", import.meta.url), "utf8")) as Fixture;
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));

function directoryOf(...users: string[]): Directory {
  const directory: Directory = new Map();
  for (const device of fixture.devices.filter((d) => users.includes(d.userId))) {
    directory.set(device.userId, new Map([[device.deviceId, toBase64(bytes(device.signatureKey))]]));
  }
  return directory;
}

describe("the server's rules on real OpenMLS messages", () => {
  it("reads OpenMLS key packages", () => {
    for (const device of fixture.devices) {
      const parsed = readKeyPackage(bytes(device.keyPackage));
      expect(parsed.identity).toBe(`${device.userId}/${device.deviceId}`);
      expect(toBase64(parsed.signatureKey)).toBe(toBase64(bytes(device.signatureKey)));
      expect(parsed.cipherSuite).toBe(3);
    }
  });

  it("keeps the same roster as OpenMLS through adds, a removal, leaf reuse, an update, and a message", () => {
    // Who the directory lists at each step: Carol leaves before step 1, and Dave joins the chat before step 2.
    const members = [["alice", "bob", "carol"], ["alice", "bob"], ["alice", "bob", "dave"], ["alice", "bob", "dave"], ["alice", "bob", "dave"]];
    let roster: RosterEntry[] = [];
    let epoch = 0;
    fixture.steps.forEach((step, index) => {
      const sender = fixture.devices.find((d) => d.userId === step.sender)!;
      if (step.welcome) expect(isWelcome(bytes(step.welcome))).toBe(true);
      const decision = decide({
        conversationId: fixture.groupId,
        epoch,
        roster,
        directory: directoryOf(...members[index]!),
        sender: { userId: sender.userId, deviceId: sender.deviceId },
        message: bytes(step.message),
        ...(step.welcome ? { welcome: bytes(step.welcome) } : {}),
      });
      expect(decision, `step ${index}`).toMatchObject({ ok: true, kind: step.kind });
      if (decision.ok && decision.kind === "commit") {
        roster = decision.roster;
        epoch = decision.nextEpoch;
      }
      expect(roster, `roster after step ${index}`).toEqual(step.roster);
    });
  });

  it("refuses Bob's update if Bob submits it as Alice", () => {
    const update = fixture.steps[3]!;
    const frame = readFrame(bytes(update.message));
    expect(frame).toMatchObject({ wireformat: "public", kind: "commit", sender: { type: "member", leafIndex: 1 } });
    const alice = fixture.devices[0]!;
    const decision = decide({
      conversationId: fixture.groupId,
      epoch: 3,
      roster: fixture.steps[2]!.roster,
      directory: directoryOf("alice", "bob", "dave"),
      sender: { userId: alice.userId, deviceId: alice.deviceId },
      message: bytes(update.message),
    });
    expect(decision).toMatchObject({ ok: false, error: "wrong_sender" });
  });
});
