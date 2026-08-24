import { describe, expect, it } from "vitest";
import { buildReview } from "./review";
import type { StoredSession } from "@/types";

const base = (overrides: Partial<StoredSession> = {}): StoredSession => ({
  id: "s1",
  startedAt: 0,
  endedAt: 45 * 60 * 1000,
  mode: "sermon",
  segments: [],
  chunks: [],
  scripture: [],
  glossary: [],
  culturalNotes: [],
  entities: [],
  corrections: [],
  ...overrides,
});

describe("post-session review", () => {
  it("reports the shape of the session", () => {
    const review = buildReview(
      base({
        segments: [
          { id: "a", text: "안녕하세요.", at: 0 },
          { id: "b", text: "반갑습니다.", at: 1000 },
        ],
        chunks: [{ id: "c", text: "Hello.", state: "committed", confidence: "high", at: 100 }],
      }),
    );
    expect(review.segmentCount).toBe(2);
    expect(review.chunkCount).toBe(1);
    expect(review.durationMs).toBe(45 * 60 * 1000);
    // 안녕하세요. + 반갑습니다. = 12 non-space characters.
    expect(review.koreanCharacters).toBe(12);
  });

  it("separates uncertain lines from adapted ones", () => {
    const review = buildReview(
      base({
        chunks: [
          { id: "a", text: "About three hundred.", state: "committed", confidence: "low", at: 0 },
          { id: "b", text: "Even in my name.", state: "committed", confidence: "high", at: 1, adapted: true },
        ],
      }),
    );
    expect(review.uncertain.map((c) => c.id)).toEqual(["a"]);
    expect(review.adapted.map((c) => c.id)).toEqual(["b"]);
  });

  it("finds recognition errors the interpreter had to fix repeatedly", () => {
    const review = buildReview(
      base({
        segments: [
          { id: "a", text: "류정길 목사입니다.", at: 0, corrected: true, originalText: "유정길 목사입니다." },
          { id: "b", text: "류정길 목사님이 기도하십니다.", at: 1000, corrected: true, originalText: "유정길 목사님이 기도하십니다." },
        ],
        corrections: [{ from: "유정길", to: "류정길", at: 0, english: "Ryu Jeong-gil" }],
      }),
    );
    expect(review.recurringRecognitionErrors[0]).toMatchObject({ from: "유정길", to: "류정길" });
    expect(review.recurringRecognitionErrors[0].occurrences).toBeGreaterThan(1);
  });

  it("suggests every corrected name for next time's prep sheet", () => {
    const review = buildReview(
      base({
        corrections: [{ from: "유정길", to: "류정길", at: 0, english: "Ryu Jeong-gil" }],
      }),
    );
    const suggestion = review.suggestedPrepTerms.find((t) => t.korean === "류정길");
    expect(suggestion?.english).toBe("Ryu Jeong-gil");
    expect(suggestion?.note).toContain("유정길");
  });

  it("does not suggest the same term twice", () => {
    const review = buildReview(
      base({
        corrections: [{ from: "유정길", to: "류정길", at: 0 }],
        entities: [{ korean: "류정길", english: "Ryu Jeong-gil", kind: "person" }],
      }),
    );
    expect(review.suggestedPrepTerms.filter((t) => t.korean === "류정길")).toHaveLength(1);
  });

  it("names the structural difficulties it saw", () => {
    const review = buildReview(
      base({
        segments: [{ id: "a", text: "가".repeat(80), at: 0 }],
        chunks: [
          { id: "c", text: "Adapted.", state: "committed", confidence: "low", at: 0, adapted: true },
        ],
      }),
    );
    const joined = review.challenges.join(" ");
    expect(joined).toContain("60 characters");
    expect(joined).toContain("cultural adaptation");
    expect(joined).toContain("low confidence");
  });

  it("says so plainly when nothing went wrong", () => {
    expect(buildReview(base()).challenges).toEqual([
      "No structural difficulties flagged in this session.",
    ]);
  });
});
