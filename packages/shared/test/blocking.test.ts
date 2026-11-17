import { describe, expect, it } from "vitest";
import { showsSender } from "../src/rules/blocking";

describe("who a phone shows messages from", () => {
  it("hides only the people this phone's user blocked", () => {
    const blocked = new Set(["mallory"]);
    expect(showsSender("bob", "alice", blocked)).toBe(true);
    expect(showsSender("mallory", "alice", blocked)).toBe(false);
  });

  it("always shows the user's own messages and the app's notices", () => {
    expect(showsSender("alice", "alice", new Set(["alice"]))).toBe(true);
    expect(showsSender(null, "alice", new Set())).toBe(true);
  });

  it("shows nobody else until the phone has learned its block list", () => {
    expect(showsSender("bob", "alice", null)).toBe(false);
    expect(showsSender("alice", "alice", null)).toBe(true);
    expect(showsSender(null, "alice", null)).toBe(true);
  });
});
