import { describe, expect, it } from "vitest";
import { buildHumanReviewFlags, hasSafetyReviewFlag } from "./review";

describe("human review flags", () => {
  it("flags explicit current-turn threats without creating a person score", () => {
    const flags = buildHumanReviewFlags({ sourceText: "내일 여기 불 지르겠어.", confidence: "high" });
    expect(flags.some((flag) => flag.kind === "explicit-threat")).toBe(true);
    expect(hasSafetyReviewFlag(flags)).toBe(true);
  });

  it("flags explicit self-harm language", () => {
    const flags = buildHumanReviewFlags({ sourceText: "I want to die", confidence: "high" });
    expect(flags.some((flag) => flag.kind === "self-harm-language")).toBe(true);
  });

  it.each([
    ["我要杀你", "explicit-threat"],
    ["я тебя убью", "explicit-threat"],
    ["te voy a matar", "explicit-threat"],
    ["死にたい", "self-harm-language"],
    ["je veux mourir", "self-harm-language"],
    ["أريد أن أموت", "self-harm-language"],
  ] as const)("flags an explicit multilingual safety phrase: %s", (sourceText, kind) => {
    expect(buildHumanReviewFlags({ sourceText, confidence: "high" }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ kind })]));
  });

  it("does not flag ordinary use of violent vocabulary without an explicit threat pattern", () => {
    const flags = buildHumanReviewFlags({
      sourceText: "The movie was about a murder investigation.",
      confidence: "high",
    });
    expect(hasSafetyReviewFlag(flags)).toBe(false);
  });

  it("flags translation integrity mismatches and low confidence for human checking", () => {
    const flags = buildHumanReviewFlags({
      sourceText: "예약은 3시입니다.",
      confidence: "low",
      integrity: {
        status: "mismatch",
        issues: [{ kind: "time", sourceText: "3시", targetText: "13:00", reason: "changed" }],
      },
    });
    expect(flags.map((flag) => flag.kind)).toEqual(
      expect.arrayContaining(["translation-integrity", "low-confidence"]),
    );
    expect(hasSafetyReviewFlag(flags)).toBe(false);
  });
});
