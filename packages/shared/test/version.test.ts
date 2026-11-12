import { describe, expect, it } from "vitest";
import { versionCode } from "../src/version";

describe("versionCode", () => {
  it("turns a version into Android's build code", () => {
    expect(versionCode("0.2.0")).toBe(200);
    expect(versionCode("0.2.1")).toBe(201);
    expect(versionCode("1.0.0")).toBe(10_000);
    expect(versionCode("1.12.3")).toBe(11_203);
  });

  it("puts every new version above the old counted builds", () => {
    expect(versionCode("0.2.0")).toBeGreaterThan(3);
  });

  it("refuses versions it can't order", () => {
    expect(() => versionCode("0.2")).toThrow();
    expect(() => versionCode("0.100.0")).toThrow();
    expect(() => versionCode("v1.0.0")).toThrow();
  });
});
