import { describe, expect, it } from "vitest";
import { classifyInputLevel, rmsOf } from "./audio-level";

describe("booth input level", () => {
  it("classifies absent, weak, usable and hot signals coarsely", () => {
    expect(classifyInputLevel(0).state).toBe("silent");
    expect(classifyInputLevel(0.015).state).toBe("low");
    expect(classifyInputLevel(0.08).state).toBe("good");
    expect(classifyInputLevel(0.4).state).toBe("hot");
  });

  it("caps the visual meter without inventing fake precision", () => {
    expect(classifyInputLevel(0.5).meter).toBe(1);
    expect(classifyInputLevel(Number.NaN).meter).toBe(0);
  });

  it("computes RMS for a captured time-domain frame", () => {
    const value = rmsOf(new Float32Array([1, -1, 1, -1]));
    expect(value).toBeCloseTo(1);
  });
});
