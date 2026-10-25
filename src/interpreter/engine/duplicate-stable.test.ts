import { describe, expect, it } from "vitest";
import { emptyPrepSheet } from "@/types";
import { InterpretationEngine, __resetSegmentIds } from "./session";
import { __resetChunkIds } from "./chunks";
import { DUPLICATE_STABLE_WINDOW_MS, isDuplicateStable } from "./stabiliser";

const SENTENCE = "우리는 하나님의 부르심을 받은 사람들입니다.";

function engineAt() {
  __resetChunkIds();
  __resetSegmentIds();
  let now = 50_000;
  const engine = new InterpretationEngine({
    context: "worship",
    lag: "balanced",
    prep: emptyPrepSheet(),
    now: () => now,
    onChange: () => {},
    interpret: async () => ({
      output: { safeChunks: [], confidence: "high" as const },
      provider: "test",
      model: "test",
    }),
  });
  engine.start();
  return {
    engine,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("duplicate stable results", () => {
  it("drops an exact repeat of the previous segment inside the window", () => {
    const { engine, advance } = engineAt();
    engine.handleStable(SENTENCE);
    advance(600);
    engine.handleStable(SENTENCE);
    expect(engine.snapshot().segments.map((s) => s.text)).toEqual([SENTENCE]);
    expect(engine.laneStats().duplicateStableDropped).toBe(1);
  });

  it("keeps a repeat that arrives after the window — the speaker may have repeated it", () => {
    const { engine, advance } = engineAt();
    engine.handleStable(SENTENCE);
    advance(DUPLICATE_STABLE_WINDOW_MS + 1);
    engine.handleStable(SENTENCE);
    expect(engine.snapshot().segments).toHaveLength(2);
    expect(engine.laneStats().duplicateStableDropped).toBe(0);
  });

  it("keeps short repeats, which are speech and not artefacts", () => {
    const { engine, advance } = engineAt();
    engine.handleStable("아멘.");
    advance(300);
    engine.handleStable("아멘.");
    expect(engine.snapshot().segments).toHaveLength(2);
  });

  it("keeps a near-repeat — only exact text is a replay", () => {
    const { engine, advance } = engineAt();
    engine.handleStable(SENTENCE);
    advance(300);
    engine.handleStable("우리는 하나님의 부르심을 받은 사람들입니다");
    expect(engine.snapshot().segments).toHaveLength(2);
  });

  it("does not let the dropped repeat reach the interpretation buffer", async () => {
    const { engine, advance } = engineAt();
    engine.handleStable(SENTENCE);
    advance(100);
    engine.handleStable(SENTENCE);
    // One sentence boundary → one flush → one turn, never two.
    engine.tick();
    await new Promise((resolve) => setImmediate(resolve));
    expect(engine.laneStats().turns).toBe(1);
  });
});

describe("isDuplicateStable", () => {
  it("is a pure rule over text length, equality and time", () => {
    const previous = { text: SENTENCE, at: 1_000 };
    expect(isDuplicateStable(previous, SENTENCE, 1_500)).toBe(true);
    expect(isDuplicateStable(previous, ` ${SENTENCE} `, 1_500)).toBe(true);
    expect(isDuplicateStable(previous, SENTENCE, 1_000 + DUPLICATE_STABLE_WINDOW_MS + 1)).toBe(false);
    expect(isDuplicateStable({ text: "아멘", at: 1_000 }, "아멘", 1_100)).toBe(false);
  });
});
