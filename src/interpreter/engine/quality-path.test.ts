/**
 * The quality path and the memory fast path, as races and as rules.
 *
 *   - a validated remembered rendering answers a turn without the model;
 *   - a cloud rewrite that only restyles the provisional line is not shown;
 *   - a result for a turn whose source was corrected meanwhile is dropped and
 *     the corrected source is interpreted afresh;
 *   - the request carries the pair, the domain and a route tier;
 *   - a manual context change that keeps the prompt layer does not invalidate;
 *   - recogniser metadata reaches the transcript.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { InterpretRequest } from "@/lib/schema";
import type { InterpreterOutput } from "@/types";
import { emptyPrepSheet } from "@/types";
import {
  InterpretationEngine,
  TRANSLATION_MEMORY_PROVIDER,
  __resetSegmentIds,
  type ContextualTurnInfo,
  type InterpretResult,
  type TurnTiming,
} from "./session";
import { __resetChunkIds } from "./chunks";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const safe = (...texts: string[]): InterpreterOutput => ({
  safeChunks: texts.map((text) => ({ text, confidence: "high" as const })),
  confidence: "high",
});

const cloud = (output: InterpreterOutput, extra: Partial<InterpretResult> = {}): InterpretResult => ({
  output,
  provider: "openrouter",
  model: "test-model",
  ...extra,
});

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function harness(options: {
  lane?: boolean;
  context?: "auto" | "sermon" | "generic" | "meeting";
  pair?: { source: string; target: string };
} = {}) {
  __resetChunkIds();
  __resetSegmentIds();
  let now = 10_000;
  const cloudCalls: Array<{ request: InterpretRequest; signal: AbortSignal; turn: ContextualTurnInfo; d: Deferred<InterpretResult> }> = [];
  const laneCalls: Array<{ text: string; d: Deferred<InterpreterOutput | null> }> = [];
  const timings: TurnTiming[] = [];

  const engine = new InterpretationEngine({
    context: options.context ?? "sermon",
    languagePair: options.pair,
    lag: "balanced",
    prep: emptyPrepSheet(),
    now: () => now,
    onChange: () => {},
    onTurnTiming: (timing) => timings.push(timing),
    interpret: (request, signal, turn) => {
      const d = deferred<InterpretResult>();
      cloudCalls.push({ request, signal, turn, d });
      return d.promise;
    },
    provisional:
      options.lane === false
        ? undefined
        : {
            isReady: () => true,
            translate: (text) => {
              const d = deferred<InterpreterOutput | null>();
              laneCalls.push({ text, d });
              return d.promise;
            },
            provider: "browser-on-device",
            model: "chrome-translator",
          },
  });
  engine.start();

  return {
    engine,
    cloudCalls,
    laneCalls,
    timings,
    say: (text: string, meta?: { confidence?: number; alternatives?: string[] }) => {
      engine.handleStable(text, meta);
      engine.tick();
    },
    advance: (ms: number) => {
      now += ms;
      engine.tick();
    },
    chunks: () => engine.snapshot().chunks,
    texts: () => engine.snapshot().chunks.map((c) => c.text),
    stats: () => engine.laneStats(),
    lastCloud: () => cloudCalls[cloudCalls.length - 1],
    lastLane: () => laneCalls[laneCalls.length - 1],
  };
}

const A = "우리는 하나님의 부르심을 받은 사람들입니다.";
const B = "오늘 우리는 서로를 사랑해야 합니다.";

beforeEach(() => {
  __resetChunkIds();
  __resetSegmentIds();
});

describe("request contract", () => {
  it("carries the language pair, the resolved domain and a route tier", () => {
    const h = harness({ lane: false });
    h.say(A);
    const { request } = h.lastCloud();
    expect(request.languagePair).toEqual({ source: "ko-KR", target: "en-US" });
    expect(request.domain).toBe("sermon");
    expect(request.mode).toBe("sermon");
    expect(["fast", "contextual", "deep"]).toContain(request.routeTier);
    expect(request.detected?.hypotheses).toEqual([]);
    expect(request.detected?.memory).toEqual([]);
  });

  it("marks a unit with a suspicious recogniser confidence as deep", () => {
    const h = harness({ lane: false });
    h.say(A, { confidence: 0.3 });
    expect(h.lastCloud().request.routeTier).toBe("deep");
  });

  it("uses the general layer for a meeting and never runs Korean-only detectors on a Chinese source", () => {
    const h = harness({ lane: false, context: "meeting", pair: { source: "zh-CN", target: "ko-KR" } });
    h.say("我们今天要讨论第三季度的预算。");
    const { request } = h.lastCloud();
    expect(request.mode).toBe("general");
    expect(request.languagePair).toEqual({ source: "zh-CN", target: "ko-KR" });
    expect(request.detected?.scripture).toEqual([]);
    expect(request.detected?.culturalNotes).toEqual([]);
    expect(h.engine.snapshot().domain.domain).toBe("meeting");
  });

  it("keeps recogniser metadata beside the transcript without overwriting the raw text", () => {
    const h = harness({ lane: false });
    h.say(A, { confidence: 0.91, alternatives: ["우리는 하나님의 부르심을 받은 사람들 입니다."] });
    const [segment] = h.engine.snapshot().segments;
    expect(segment.confidence).toBe(0.91);
    expect(segment.alternatives).toHaveLength(1);
    expect(segment.text).toBe(A);
  });
});

describe("memory fast path", () => {
  it("answers a repeated, user-validated rendering without calling the model", async () => {
    const h = harness({ lane: false });
    h.say(A);
    h.lastCloud().d.resolve(cloud(safe("We are those God called.")));
    await settle();
    expect(h.cloudCalls).toHaveLength(1);

    // The interpreter prefers their own wording for this sentence.
    h.engine.correct(A, "We are the people God has called.", { scope: "target" });
    expect(h.texts()).toEqual(["We are the people God has called."]);

    h.say(A);
    await settle();
    expect(h.cloudCalls).toHaveLength(1);
    expect(h.stats().memoryHits).toBe(1);
    expect(h.stats().cloudSkipped).toBe(1);
    const last = h.chunks()[h.chunks().length - 1];
    expect(last.text).toBe("We are the people God has called.");
    expect(last.origin).toBe("tm");
    expect(last.provisional).toBeUndefined();
    expect(h.timings.at(-1)).toMatchObject({
      lane: "provisional",
      provider: TRANSLATION_MEMORY_PROVIDER,
      firstUseful: true,
      turnId: 2,
    });
    expect(h.engine.snapshot().thinking).toBe(false);
  });

  it("keeps a single model rendering as a hint, never as an answer", async () => {
    const h = harness({ lane: false });
    h.say(A);
    h.lastCloud().d.resolve(cloud(safe("We are those God called.")));
    await settle();
    h.say(A);
    expect(h.cloudCalls).toHaveLength(2);
    expect(h.lastCloud().request.detected?.memory).toEqual([
      { source: A, target: "We are those God called." },
    ]);
    expect(h.stats().memoryHits).toBe(0);
  });
});

describe("output stability", () => {
  it("does not replace a provisional line with a restyled paraphrase", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("Please sign in first."));
    await settle();
    h.lastCloud().d.resolve(cloud(safe("First, please log in.")));
    await settle();
    expect(h.texts()).toEqual(["Please sign in first."]);
    expect(h.chunks()[0].provisional).toBe(false);
    expect(h.stats().contextualKeptStylistic).toBe(1);
    expect(h.stats().contextualRefined).toBe(0);
  });

  it("does replace a provisional line when the meaning differs", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("Please sign in first."));
    await settle();
    h.lastCloud().d.resolve(cloud(safe("Please do not sign in first.")));
    await settle();
    expect(h.texts()).toEqual(["Please do not sign in first."]);
    expect(h.stats().contextualRefined).toBe(1);
  });

  it("replaces a provisional line that dropped a number the source carried", async () => {
    const h = harness();
    h.say("다음 주 화요일 오후 3시에 모이겠습니다.");
    h.lastLane().d.resolve(safe("We will meet next Tuesday afternoon."));
    await settle();
    h.lastCloud().d.resolve(cloud(safe("We will meet next Tuesday at 3 pm.")));
    await settle();
    expect(h.texts()).toEqual(["We will meet next Tuesday at 3 pm."]);
  });
});

describe("revision safety", () => {
  it("drops a result for a turn whose source was corrected while it was in flight, then re-interprets the corrected text", async () => {
    const h = harness({ lane: false });
    h.say("오늘 말씀은 유정기 목사님께서 전해 주시겠습니다.");
    expect(h.cloudCalls).toHaveLength(1);

    h.engine.correct("유정기", "류정길", { english: "Ryu Jeong-gil" });
    h.lastCloud().d.resolve(cloud(safe("Today's message is from Pastor Yu Jeong-gi.")));
    await settle();

    expect(h.texts()).toEqual([]);
    expect(h.stats().revisionStale).toBe(1);
    expect(h.timings.at(-1)).toMatchObject({ outcome: "stale" });

    h.advance(3_000);
    expect(h.cloudCalls).toHaveLength(2);
    expect(h.lastCloud().request.pending).toContain("류정길");
    expect(h.lastCloud().request.pending).not.toContain("유정기");
    expect(h.lastCloud().request.context.entities.some((e) => e.korean === "류정길" && e.english === "Ryu Jeong-gil")).toBe(true);
  });

  it("does not disturb a turn the correction never touched", async () => {
    const h = harness({ lane: false });
    h.say(B);
    h.engine.correct("유정기", "류정길");
    h.lastCloud().d.resolve(cloud(safe("Today we must love one another.")));
    await settle();
    expect(h.texts()).toEqual(["Today we must love one another."]);
    expect(h.stats().revisionStale).toBe(0);
  });
});

describe("context changes", () => {
  it("keeps in-flight work when the manual context stays within the same layer", async () => {
    const h = harness({ lane: false, context: "meeting" });
    h.say(B);
    h.engine.setContext("lecture");
    h.lastCloud().d.resolve(cloud(safe("Today we must love one another.")));
    await settle();
    expect(h.texts()).toEqual(["Today we must love one another."]);
    expect(h.engine.snapshot().domain).toMatchObject({ domain: "lecture", source: "manual" });
  });

  it("invalidates in-flight work when the layer changes, and re-interprets under the new one", async () => {
    const h = harness({ lane: false, context: "sermon" });
    h.say(B);
    h.engine.setContext("meeting");
    expect(h.cloudCalls[0].signal.aborted).toBe(true);
    h.cloudCalls[0].d.reject(new DOMException("aborted", "AbortError"));
    await settle();
    h.advance(3_000);
    expect(h.cloudCalls).toHaveLength(2);
    expect(h.lastCloud().request.mode).toBe("general");
    expect(h.lastCloud().request.domain).toBe("meeting");
  });
});

describe("entity memory across the session", () => {
  it("binds a corrected name and reuses it when the recogniser writes it differently again", async () => {
    const h = harness({ lane: false });
    h.engine.correct("뉴스송 처치", "뉴송교회", { english: "New Song Church" });
    h.say("뉴송교회에 오신 여러분을 환영합니다.");
    h.lastCloud().d.resolve(cloud(safe("Welcome, everyone, to New Song Church.")));
    await settle();

    h.say("뉴 송 교회는 올해 스무 살이 되었습니다.");
    const segment = h.engine.snapshot().segments.at(-1)!;
    expect(segment.text).toContain("뉴송교회");
    expect(segment.repaired).toBe(true);
    expect(segment.rawText).toContain("뉴 송 교회");
    expect(h.stats().repairsAccepted).toBeGreaterThanOrEqual(1);
    expect(h.lastCloud().request.pending).toContain("뉴송교회");
  });
});
