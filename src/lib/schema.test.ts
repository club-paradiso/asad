import { describe, expect, it } from "vitest";
import { migrateSession, migrateSettings } from "./storage";
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
    context: "worship",
    lag: "balanced",
    pending: "우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.",
    history: { recentKorean: [], recentEnglish: [], glossary: [], entities: [], scripture: [], corrections: [] },
  };

  it("accepts a minimal request and applies defaults", () => {
    const result = interpretRequestSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.allowAnticipation).toBe(true);
  });

  it("accepts bounded transcript-free client latency samples", () => {
    const result = interpretRequestSchema.safeParse({ ...base, clientTelemetry: [{ id: "c1-1", stage: "stable_to_render", ms: 1840, provider: "openrouter" }] });
    expect(result.success).toBe(true);
  });

  it("rejects invalid client latency stages", () => {
    const result = interpretRequestSchema.safeParse({ ...base, clientTelemetry: [{ id: "c1-1", stage: "raw_transcript", ms: 20 }] });
    expect(result.success).toBe(false);
  });

  it("rejects an empty pending buffer", () => {
    expect(interpretRequestSchema.safeParse({ ...base, pending: "" }).success).toBe(false);
  });

  it("rejects an unknown context", () => {
    expect(interpretRequestSchema.safeParse({ ...base, context: "courtroom" }).success).toBe(false);
    // `auto` is what the USER may ask for. It is resolved in the browser, so a
    // request carrying it is a request that skipped the resolver.
    expect(interpretRequestSchema.safeParse({ ...base, context: "auto" }).success).toBe(false);
  });

  it("rejects a malformed language tag before it reaches a provider", () => {
    expect(interpretRequestSchema.safeParse({ ...base, source: "not a tag" }).success).toBe(false);
    expect(interpretRequestSchema.safeParse({ ...base, target: "" }).success).toBe(false);
    expect(interpretRequestSchema.safeParse({ ...base, source: "zh-TW" }).success).toBe(true);
  });

  it("defaults the pair to Korean → English", () => {
    const result = interpretRequestSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe("ko-KR");
      expect(result.data.target).toBe("en-US");
    }
  });

  it("bounds the pending buffer so one call cannot blow up", () => {
    expect(
      interpretRequestSchema.safeParse({ ...base, pending: "가".repeat(5000) }).success,
    ).toBe(false);
  });
});

describe("stored state written before contexts and language pairs existed", () => {
  it("reads an old Sermon setting forward as an explicit worship override", () => {
    // Not `auto`: someone who deliberately chose Sermon gets a different
    // product if that choice is quietly dropped on upgrade.
    const migrated = migrateSettings({ mode: "sermon", lag: "safe", showKorean: false });
    expect(migrated.context).toBe("worship");
    expect(migrated.showSource).toBe(false);
    expect(migrated.lag).toBe("safe");
    expect(migrated.sourceLanguage).toBe("ko-KR");
    expect(migrated.targetLanguage).toBe("en-US");
    expect(migrated).not.toHaveProperty("mode");
    expect(migrated).not.toHaveProperty("showKorean");
  });

  it("reads an old General setting forward as auto", () => {
    // "General" meant "no domain steer", and the honest modern form of that is
    // "stop asking" — which is what auto does.
    expect(migrateSettings({ mode: "general" }).context).toBe("auto");
  });

  it("leaves already-migrated settings alone", () => {
    const migrated = migrateSettings({ context: "meeting", showSource: false, fontScale: 1.4 });
    expect(migrated.context).toBe("meeting");
    expect(migrated.showSource).toBe(false);
    expect(migrated.fontScale).toBe(1.4);
  });

  it("reads an old saved session forward rather than discarding it", () => {
    const migrated = migrateSession({
      id: "session-1",
      startedAt: 1,
      mode: "sermon",
      segments: [],
      chunks: [],
    });
    expect(migrated.context).toBe("worship");
    expect(migrated.sourceLanguage).toBe("ko-KR");
    expect(migrated.targetLanguage).toBe("en-US");
    expect(migrated).not.toHaveProperty("mode");
  });
});
