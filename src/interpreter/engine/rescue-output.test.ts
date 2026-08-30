import { describe, expect, it } from "vitest";
import { emptyRescueOutput, sanitizeRescueOutput } from "./rescue-output";

describe("Rescue output boundary", () => {
  it("strips anticipation and caps recovery speech at two chunks", () => {
    const output = sanitizeRescueOutput({
      safeChunks: [
        { text: "First", confidence: "high" },
        { text: "Second", confidence: "medium" },
        { text: "Third", confidence: "low" },
      ],
      anticipatedChunks: [{ text: "Prediction", confidence: "low" }],
      confidence: "medium",
      topic: "hope",
    });

    expect(output.safeChunks.map((chunk) => chunk.text)).toEqual(["First", "Second"]);
    expect(output.anticipatedChunks).toBeUndefined();
    expect(output.topic).toBe("hope");
  });

  it("fails closed when no rescue model is available", () => {
    expect(emptyRescueOutput()).toEqual({ safeChunks: [], confidence: "low" });
  });
});
