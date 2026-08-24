import { describe, expect, it } from "vitest";
import {
  extractJsonObject,
  interpretRequestSchema,
  interpreterOutputSchema,
  parseInterpreterOutput,
} from "./schema";

describe("recovering JSON from model output", () => {
  it("reads a bare object", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("reads an object wrapped in prose", () => {
    expect(extractJsonObject('Sure! Here you go:\n```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("is not fooled by braces inside strings", () => {
    const raw = '{"text":"a } brace","n":1}';
    expect(extractJsonObject(`prefix ${raw} suffix`)).toBe(raw);
  });

  it("handles escaped quotes", () => {
    const raw = '{"text":"he said \\"hello\\""}';
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it("returns null when there is no object", () => {
    expect(extractJsonObject("I cannot help with that.")).toBeNull();
  });
});

describe("interpreter output validation", () => {
  it("accepts a well-formed turn", () => {
    const output = parseInterpreterOutput(
      JSON.stringify({
        safeChunks: [{ text: "Today we're going to look at...", confidence: "high" }],
        confidence: "high",
      }),
    );
    expect(output?.safeChunks[0].text).toBe("Today we're going to look at...");
  });

  it("fills in the defaults the model omitted", () => {
    const output = parseInterpreterOutput(JSON.stringify({ safeChunks: [{ text: "Hello." }] }));
    expect(output?.safeChunks[0].confidence).toBe("medium");
    expect(output?.confidence).toBe("medium");
  });

  it("returns null rather than throwing on malformed output", () => {
    // A bad model turn must never end a live session.
    expect(parseInterpreterOutput("not json at all")).toBeNull();
    expect(parseInterpreterOutput('{"safeChunks": "a string"}')).toBeNull();
    expect(parseInterpreterOutput('{"broken": ')).toBeNull();
  });

  it("rejects an invalid confidence band instead of coercing it", () => {
    expect(parseInterpreterOutput('{"safeChunks":[{"text":"x"}],"confidence":"very high"}')).toBeNull();
  });

  it("rejects an empty chunk", () => {
    expect(interpreterOutputSchema.safeParse({ safeChunks: [{ text: "" }] }).success).toBe(false);
  });

  it("caps how much a single turn can emit", () => {
    const tooMany = { safeChunks: Array.from({ length: 20 }, () => ({ text: "line" })) };
    expect(interpreterOutputSchema.safeParse(tooMany).success).toBe(false);
  });

  it("rejects an impossible Bible reference", () => {
    const result = interpreterOutputSchema.safeParse({
      safeChunks: [{ text: "x" }],
      bibleReferences: [{ book: "1 Peter", chapter: 0, display: "1 Peter 0" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("interpret request validation", () => {
  const base = {
    mode: "sermon",
    lag: "balanced",
    pending: "우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.",
    context: { recentKorean: [], recentEnglish: [], glossary: [], entities: [], scripture: [], corrections: [] },
  };

  it("accepts a minimal request and applies defaults", () => {
    const result = interpretRequestSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.allowAnticipation).toBe(true);
  });

  it("rejects an empty pending buffer", () => {
    expect(interpretRequestSchema.safeParse({ ...base, pending: "" }).success).toBe(false);
  });

  it("rejects an unknown mode", () => {
    expect(interpretRequestSchema.safeParse({ ...base, mode: "courtroom" }).success).toBe(false);
  });

  it("bounds the pending buffer so one call cannot blow up", () => {
    expect(
      interpretRequestSchema.safeParse({ ...base, pending: "가".repeat(5000) }).success,
    ).toBe(false);
  });
});
