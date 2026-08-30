import { describe, expect, it } from "vitest";
import { isBoothPreflightReady } from "./BoothPreflight";

describe("isBoothPreflightReady", () => {
  it("requires both a verified usable signal and mix-minus confirmation", () => {
    expect(isBoothPreflightReady(false, false)).toBe(false);
    expect(isBoothPreflightReady(true, false)).toBe(false);
    expect(isBoothPreflightReady(false, true)).toBe(false);
    expect(isBoothPreflightReady(true, true)).toBe(true);
  });
});
