import { describe, expect, it } from "vitest";
import { isMlsTester, mlsMayMove, mlsOnFor, parseMlsMode, parseMlsTesters } from "../src/mlsRollout";

const alice = { id: "user-alice", email: "Alice@Example.test" };
const bob = { id: "user-bob", email: "bob@example.test" };
const carol = { id: "user-carol", email: "carol@example.test" };

describe("MLS_ENABLED", () => {
  it("reads the four modes, and anything unknown is off", () => {
    expect(parseMlsMode("true")).toBe("on");
    expect(parseMlsMode("testers")).toBe("testers");
    expect(parseMlsMode("paused")).toBe("paused");
    for (const value of ["false", "", undefined, "TRUE", "tester", " testers"]) expect(parseMlsMode(value)).toBe("off");
  });
});

describe("MLS_TESTERS", () => {
  it("takes emails without case and user IDs exactly, split on commas, spaces or new lines", () => {
    const testers = parseMlsTesters(" alice@example.test,user-bob\n  ,CAROL@example.test ");
    expect(isMlsTester(testers, alice)).toBe(true);
    expect(isMlsTester(testers, bob)).toBe(true);
    expect(isMlsTester(testers, carol)).toBe(true);
    expect(isMlsTester(testers, { id: "USER-BOB", email: "someone@example.test" })).toBe(false);
  });

  it("names nobody when empty or missing", () => {
    for (const value of [undefined, "", " , \n"]) {
      const testers = parseMlsTesters(value);
      expect(isMlsTester(testers, alice)).toBe(false);
      expect(isMlsTester(testers, { id: "", email: "" })).toBe(false);
    }
  });
});

describe("who hears MLS is on", () => {
  const testers = parseMlsTesters("alice@example.test");

  it("is everyone when on or paused, only testers in the testers stage, and nobody when off", () => {
    expect(mlsOnFor("on", testers, bob)).toBe(true);
    expect(mlsOnFor("paused", testers, bob)).toBe(true);
    expect(mlsOnFor("testers", testers, alice)).toBe(true);
    expect(mlsOnFor("testers", testers, bob)).toBe(false);
    expect(mlsOnFor("off", testers, alice)).toBe(false);
  });
});

describe("whether a chat may move to MLS", () => {
  const testers = parseMlsTesters("alice@example.test user-bob");

  it("moves any chat when on, and none when paused or off", () => {
    expect(mlsMayMove("on", testers, [alice, carol])).toBe(true);
    expect(mlsMayMove("paused", testers, [alice, bob])).toBe(false);
    expect(mlsMayMove("off", testers, [alice, bob])).toBe(false);
  });

  it("in the testers stage, moves a chat only when every member is a tester", () => {
    expect(mlsMayMove("testers", testers, [alice, bob])).toBe(true);
    expect(mlsMayMove("testers", testers, [alice, bob, carol])).toBe(false);
    expect(mlsMayMove("testers", testers, [carol])).toBe(false);
    // A chat with nobody active in it has nobody to vouch for.
    expect(mlsMayMove("testers", testers, [])).toBe(false);
  });
});
