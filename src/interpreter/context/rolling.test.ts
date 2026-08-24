import { describe, expect, it } from "vitest";
import { CONTEXT_BUDGET, buildRollingContext, compressHistory, estimateTokens } from "./rolling";
import { emptyMemory, memoryFromPrep, applyCorrection, rememberKnowledge } from "./memory";
import { emptyPrepSheet, type InterpretationChunk, type TranscriptSegment } from "@/types";

const segments = (count: number, text = "우리는 하나님의 부르심을 받은 사람들입니다."): TranscriptSegment[] =>
  Array.from({ length: count }, (_, i) => ({ id: `s${i}`, text, at: i * 5000 }));

const chunks = (count: number): InterpretationChunk[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    text: `English line number ${i}.`,
    state: "committed" as const,
    confidence: "high" as const,
    at: i * 5000,
  }));

describe("rolling context window", () => {
  it("stays bounded no matter how long the session runs", () => {
    const context = buildRollingContext({
      segments: segments(400),
      chunks: chunks(400),
      memory: emptyMemory(),
      mode: "sermon",
      prep: emptyPrepSheet(),
    });

    expect(context.recentKorean.length).toBeLessThanOrEqual(CONTEXT_BUDGET.maxSegments);
    expect(context.recentEnglish.length).toBeLessThanOrEqual(CONTEXT_BUDGET.maxChunks);
    expect(context.recentKorean.join("").length).toBeLessThanOrEqual(
      CONTEXT_BUDGET.koreanChars + 200,
    );
  });

  it("keeps the most recent speech, not the oldest", () => {
    const list = segments(30);
    list[list.length - 1] = { id: "last", text: "마지막 문장입니다.", at: 999999 };
    const context = buildRollingContext({
      segments: list,
      chunks: [],
      memory: emptyMemory(),
      mode: "sermon",
      prep: emptyPrepSheet(),
    });
    expect(context.recentKorean[context.recentKorean.length - 1]).toBe("마지막 문장입니다.");
  });

  it("never feeds a prediction back as though it had been said", () => {
    const withGuess: InterpretationChunk[] = [
      ...chunks(2),
      { id: "guess", text: "A prediction.", state: "anticipated", confidence: "low", at: 100 },
    ];
    const context = buildRollingContext({
      segments: [],
      chunks: withGuess,
      memory: emptyMemory(),
      mode: "sermon",
      prep: emptyPrepSheet(),
    });
    expect(context.recentEnglish).not.toContain("A prediction.");
  });

  it("compresses what fell out of the window instead of dropping it", () => {
    let memory = emptyMemory();
    memory = rememberKnowledge(memory, {
      scripture: ["1 Peter 2:9"],
      glossary: [{ korean: "부르심", english: "calling" }],
      topic: "Our identity",
    });

    const context = buildRollingContext({
      segments: segments(60),
      chunks: [],
      memory,
      mode: "sermon",
      prep: emptyPrepSheet(),
    });

    expect(context.summary).toContain("1 Peter 2:9");
    expect(context.summary).toContain("부르심");
    expect(context.summary).toContain("Our identity");
    expect(context.summary.length).toBeLessThanOrEqual(CONTEXT_BUDGET.summaryChars);
  });

  it("has nothing to compress at the start of a session", () => {
    expect(compressHistory([], emptyMemory(), "sermon")).toBe("");
  });

  it("carries the prep sheet through", () => {
    const context = buildRollingContext({
      segments: [],
      chunks: [],
      memory: emptyMemory(),
      mode: "sermon",
      prep: { ...emptyPrepSheet(), speaker: "류정길", scripture: "1 Peter 2:9" },
    });
    expect(context.prep?.speaker).toBe("류정길");
    expect(context.prep?.scripture).toBe("1 Peter 2:9");
  });

  it("omits the prep block entirely when nothing was prepared", () => {
    const context = buildRollingContext({
      segments: [],
      chunks: [],
      memory: emptyMemory(),
      mode: "sermon",
      prep: emptyPrepSheet(),
    });
    expect(context.prep).toBeUndefined();
  });

  it("keeps the per-call estimate small enough for a 70-minute session", () => {
    const context = buildRollingContext({
      segments: segments(500),
      chunks: chunks(500),
      memory: emptyMemory(),
      mode: "sermon",
      prep: emptyPrepSheet(),
    });
    // Bounded context is what keeps a long service affordable and fast.
    expect(estimateTokens(context, "새로운 문장입니다.")).toBeLessThan(2000);
  });
});

describe("session memory", () => {
  it("seeds itself from the prep sheet and romanises the speaker", () => {
    const memory = memoryFromPrep({ ...emptyPrepSheet(), speaker: "류정길", title: "Identity" });
    expect(memory.entities[0].english).toBe("Ryu Jeong-gil");
    expect(memory.topic).toBe("Identity");
  });

  it("treats a correction as permanent and binds the romanisation", () => {
    const memory = applyCorrection(emptyMemory(), { from: "유정길", to: "류정길", at: 0 });
    expect(memory.corrections).toHaveLength(1);
    expect(memory.entities.find((e) => e.korean === "류정길")?.english).toBe("Ryu Jeong-gil");
  });

  it("replaces an earlier correction of the same name rather than stacking", () => {
    let memory = applyCorrection(emptyMemory(), { from: "유정길", to: "류정길", at: 0 });
    memory = applyCorrection(memory, { from: "유정길", to: "유정길", at: 10 });
    expect(memory.corrections).toHaveLength(1);
  });

  it("does not let a later guess overwrite the interpreter's romanisation", () => {
    let memory = applyCorrection(emptyMemory(), {
      from: "유정길",
      to: "류정길",
      at: 0,
      english: "Ryu Jung-gil",
    });
    memory = rememberKnowledge(memory, {
      entities: [{ korean: "류정길", english: "Yu Jeonggil", kind: "person" }],
    });
    expect(memory.entities.find((e) => e.korean === "류정길")?.english).toBe("Ryu Jung-gil");
  });

  it("de-duplicates Scripture across the session", () => {
    let memory = rememberKnowledge(emptyMemory(), { scripture: ["1 Peter 2:9"] });
    memory = rememberKnowledge(memory, { scripture: ["1 Peter 2:9", "Romans 5:8"] });
    expect(memory.scripture).toEqual(["1 Peter 2:9", "Romans 5:8"]);
  });
});
