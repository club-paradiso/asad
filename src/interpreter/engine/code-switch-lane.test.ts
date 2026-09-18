/**
 * Two behaviours the engine gained for real speech rather than for benchmarks.
 *
 * 1. PASS-THROUGH. A speaker quotes a whole English sentence inside a Korean
 *    session. Translating English into English is slower AND worse, and the
 *    fastest correct rendering of it is the sentence itself — which costs no
 *    model, no socket and no language pack, so unlike Chrome's on-device
 *    translator it works in every browser.
 *
 * 2. COALESCING WITHOUT A FAST LANE. `canFlush` used to require an idle cloud
 *    socket whenever no on-device translator was ready, which is Safari,
 *    Firefox and every phone. Newly stabilised speech then sat in the
 *    stabiliser until the previous round trip returned, so the interpreter paid
 *    the provider's latency twice on every turn: once waiting for the answer,
 *    and again because the next unit had not been cut yet.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { emptyPrepSheet, type InterpreterOutput } from "@/types";
import {
  InterpretationEngine,
  PASSTHROUGH_MODEL,
  PASSTHROUGH_PROVIDER,
  __resetSegmentIds,
  type InterpretResult,
  type TurnTiming,
} from "./session";
import { __resetChunkIds } from "./chunks";

const KOREAN = "우리는 하나님의 부르심을 받은 사람들입니다.";
const KOREAN_B = "오늘 우리는 서로를 사랑해야 합니다.";
const ENGLISH = "I don't think this is going to work.";
const MIXED = "이번 quarter의 conversion rate가 생각보다 낮습니다.";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const safe = (...texts: string[]): InterpreterOutput => ({
  safeChunks: texts.map((text) => ({ text, confidence: "high" as const })),
  confidence: "high",
});

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/** A cloud-first engine: no on-device translator, which is the common case. */
function harness(options: { lane?: boolean } = {}) {
  __resetChunkIds();
  __resetSegmentIds();
  let now = 10_000;

  const cloudCalls: Array<{ pending: string; d: Deferred<InterpretResult> }> = [];
  const laneCalls: string[] = [];
  const timings: TurnTiming[] = [];

  const engine = new InterpretationEngine({
    context: "lecture",
    source: "ko-KR",
    target: "en-US",
    lag: "balanced",
    prep: emptyPrepSheet(),
    now: () => now,
    onChange: () => {},
    onTurnTiming: (timing) => timings.push(timing),
    interpret: (request) => {
      const d = deferred<InterpretResult>();
      cloudCalls.push({ pending: request.pending, d });
      return d.promise;
    },
    provisional: options.lane
      ? {
          isReady: () => true,
          translate: async (text) => {
            laneCalls.push(text);
            return safe(`ON-DEVICE(${text})`);
          },
          provider: "browser-on-device",
          model: "chrome-translator",
        }
      : undefined,
  });
  engine.start();

  return {
    engine,
    cloudCalls,
    laneCalls,
    timings,
    say: (text: string) => {
      engine.handleStable(text);
      engine.tick();
    },
    advance: (ms: number) => {
      now += ms;
      engine.tick();
    },
    texts: () => engine.snapshot().chunks.map((c) => c.text),
    chunks: () => engine.snapshot().chunks,
    stats: () => engine.laneStats(),
  };
}

beforeEach(() => {
  __resetChunkIds();
  __resetSegmentIds();
});

describe("a unit already spoken in the target language", () => {
  it("reaches the screen without waiting for anything", async () => {
    const h = harness();
    h.say(ENGLISH);
    await settle();

    // No cloud answer yet, and no on-device translator in this browser at all.
    expect(h.cloudCalls).toHaveLength(1);
    expect(h.texts()).toEqual([ENGLISH]);

    const chunk = h.chunks()[0];
    expect(chunk.provisional).toBe(true);
    expect(chunk.state).toBe("current");
    expect(h.stats().provisionalPassthrough).toBe(1);
  });

  it("is reported as itself rather than as a translation", async () => {
    const h = harness();
    h.say(ENGLISH);
    await settle();
    const timing = h.timings.find((t) => t.lane === "provisional");
    expect(timing?.provider).toBe(PASSTHROUGH_PROVIDER);
    expect(timing?.model).toBe(PASSTHROUGH_MODEL);
    // Zero: the words were already on screen the moment the recogniser
    // settled them.
    expect(timing!.safeAt - timing!.stableAt).toBe(0);
  });

  it("still lets the cloud refine it while it is editable", async () => {
    const h = harness();
    h.say(ENGLISH);
    await settle();

    h.cloudCalls[0].d.resolve({
      output: safe("I don't think this will work."),
      provider: "openrouter",
      model: "m",
    });
    await settle();
    expect(h.texts()).toEqual(["I don't think this will work."]);
  });

  it("never passes Korean through untranslated", async () => {
    const h = harness();
    h.say(KOREAN);
    await settle();
    // The turn waits for the cloud, exactly as it always has.
    expect(h.texts()).toEqual([]);
    expect(h.stats().provisionalPassthrough).toBe(0);
  });

  it("does not pass a mixed Korean sentence through either", async () => {
    // Two English nouns do not make a Korean sentence English, and rendering
    // it verbatim would leave the Korean around them untranslated.
    const h = harness();
    h.say(MIXED);
    await settle();
    expect(h.texts()).toEqual([]);
    expect(h.stats().codeSwitchedTurns).toBe(1);
  });

  it("does not spend the on-device translator on it", async () => {
    const h = harness({ lane: true });
    h.say(ENGLISH);
    await settle();
    expect(h.laneCalls).toEqual([]);
    expect(h.texts()).toEqual([ENGLISH]);
  });
});

describe("staying single-flight without a fast lane", () => {
  /**
   * This block exists because the opposite was tried.
   *
   * Letting turns be cut and coalesced while the cloud was busy looked like it
   * should cut latency on every browser without Chrome's on-device translator.
   * Measured over ten simulated minutes it did not: p50 was unchanged at ~5.7s
   * and the maximum went from 17.2s to 29.7s, because the oldest turn in a
   * coalesced unit ends up waiting for the newest. The tests below pin the
   * behaviour that measured better, so the idea is not re-derived from
   * plausibility.
   */
  it("holds newly stabilised speech in the stabiliser rather than queueing turns", async () => {
    const h = harness();
    h.say(KOREAN);
    expect(h.cloudCalls).toHaveLength(1);

    h.say(KOREAN_B);
    await settle();

    // One turn, one request. The second sentence is waiting in the stabiliser
    // with its original `pendingSince` intact.
    expect(h.stats().turns).toBe(1);
    expect(h.cloudCalls).toHaveLength(1);
  });

  it("flushes the held speech on the very next tick once the socket frees", async () => {
    const h = harness();
    h.say(KOREAN);
    h.say(KOREAN_B);
    await settle();

    h.cloudCalls[0].d.resolve({ output: safe("We are called."), provider: "p", model: "m" });
    await settle();

    // The gate costs one tick, not another trigger: `pendingSince` was never
    // reset, so the hold ceiling has already elapsed by the time it opens.
    h.advance(100);
    await settle();
    expect(h.cloudCalls).toHaveLength(2);
    expect(h.cloudCalls[1].pending).toContain(KOREAN_B);
  });

  it("never loses the speech it held", async () => {
    const h = harness();
    h.say(KOREAN);
    for (let i = 0; i < 8; i += 1) {
      h.say(`${i}번째로 ${KOREAN_B}`);
      h.advance(200);
    }
    await settle();

    h.cloudCalls[0].d.resolve({ output: safe("We are called."), provider: "p", model: "m" });
    await settle();
    h.advance(100);
    await settle();

    // Everything said while the socket was busy arrives in the next request.
    expect(h.cloudCalls).toHaveLength(2);
    for (let i = 0; i < 8; i += 1) {
      expect(h.cloudCalls[1].pending).toContain(`${i}번째로`);
    }
  });
});
