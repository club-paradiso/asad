/**
 * Two-lane races.
 *
 * Every test here is a race the engine must win deterministically: a fast
 * on-device result and a slow contextual result for the same Korean, arriving
 * in either order, before or after the interpreter may have spoken the line,
 * before or after the session ended. The rules under test:
 *
 *   - provisional English renders without waiting for the cloud;
 *   - the cloud may refine only still-editable provisional chunks of ITS turn;
 *   - committed chunks are byte-for-byte immutable, whatever arrives;
 *   - stop / restart / mode change invalidate every outstanding result;
 *   - cloud concurrency is one, later Korean is never lost, and the coalesced
 *     backlog is bounded.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { InterpretRequest } from "@/lib/schema";
import type { InterpreterOutput, LagProfile } from "@/types";
import { emptyPrepSheet } from "@/types";
import {
  InterpretationEngine,
  PROVISIONAL_TIMEOUT_MS,
  __resetSegmentIds,
  type ContextualTurnInfo,
  type InterpretResult,
  type TurnTiming,
} from "./session";
import { __resetChunkIds } from "./chunks";
import { MAX_COALESCED_TURNS } from "./turns";

const A = "우리는 하나님의 부르심을 받은 사람들입니다.";
const B = "오늘 우리는 서로를 사랑해야 합니다.";
const C = "그리고 오늘도 함께 걸어갑니다.";
const D = "믿음은 바라는 것들의 실상입니다.";

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

/** Let every settled promise run its continuation. */
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function harness(options: { laneReady?: boolean; lane?: boolean; lag?: LagProfile } = {}) {
  __resetChunkIds();
  __resetSegmentIds();
  let now = 10_000;
  let ready = options.laneReady ?? true;

  const cloudCalls: Array<{
    request: InterpretRequest;
    signal: AbortSignal;
    turn: ContextualTurnInfo;
    d: Deferred<InterpretResult>;
  }> = [];
  const laneCalls: Array<{ text: string; signal: AbortSignal; d: Deferred<InterpreterOutput | null> }> = [];
  const timings: TurnTiming[] = [];

  const engine = new InterpretationEngine({
    mode: "sermon",
    lag: options.lag ?? "balanced",
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
            isReady: () => ready,
            translate: (text, signal) => {
              const d = deferred<InterpreterOutput | null>();
              laneCalls.push({ text, signal, d });
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
    setReady: (value: boolean) => {
      ready = value;
    },
    /** Stabilise one sentence; the next tick flushes it as a turn. */
    say: (korean: string) => {
      engine.handleStable(korean);
      engine.tick();
    },
    advance: (ms: number) => {
      now += ms;
      engine.tick();
    },
    now: () => now,
    chunks: () => engine.snapshot().chunks,
    texts: () => engine.snapshot().chunks.map((c) => c.text),
    stats: () => engine.laneStats(),
    lastCloud: () => cloudCalls[cloudCalls.length - 1],
    lastLane: () => laneCalls[laneCalls.length - 1],
  };
}

beforeEach(() => {
  __resetChunkIds();
  __resetSegmentIds();
});

describe("Lane A: provisional first", () => {
  it("renders provisional English before a delayed cloud completion", async () => {
    const h = harness();
    h.say(A);
    expect(h.laneCalls).toHaveLength(1);
    expect(h.cloudCalls).toHaveLength(1);
    expect(h.laneCalls[0].text).toBe(A);

    h.lastLane().d.resolve(safe("We are people God has called."));
    await settle();

    const [chunk] = h.chunks();
    expect(chunk.text).toBe("We are people God has called.");
    expect(chunk.state).toBe("current");
    expect(chunk.provisional).toBe(true);
    expect(chunk.turnId).toBe(1);
    // The cloud has not answered; the engine is still thinking about it.
    expect(h.engine.snapshot().thinking).toBe(true);
    expect(h.timings.at(-1)).toMatchObject({ lane: "provisional", turnId: 1, hasSafe: true });
  });

  it("gives every flushed unit a monotonically increasing turn id", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("one"));
    await settle();
    h.say(B);
    h.lastLane().d.resolve(safe("two"));
    await settle();
    expect(h.chunks().map((c) => c.turnId)).toEqual([1, 2]);
    expect(h.cloudCalls[0].turn.turnIds).toEqual([1]);
  });
});

describe("Lane B: contextual refinement", () => {
  it("refines still-editable provisional output of the same turn in place", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("We are people God has called."));
    await settle();
    const provisionalId = h.chunks()[0].id;

    h.lastCloud().d.resolve(cloud(safe("We are those whom God has called.")));
    await settle();

    const chunks = h.chunks();
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("We are those whom God has called.");
    expect(chunks[0].state).toBe("current");
    expect(chunks[0].provisional).toBe(false);
    expect(chunks[0].id).not.toBe(provisionalId);
    expect(h.stats().contextualRefined).toBe(1);
    expect(h.timings.at(-1)).toMatchObject({ lane: "contextual", outcome: "refined", turnId: 1 });
    expect(h.engine.snapshot().thinking).toBe(false);
  });

  it("does not rewrite a provisional chunk that has already committed", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("We are people God has called."));
    await settle();

    // Balanced dwell is 2.6s: the line locks before the cloud answers.
    h.advance(2_600);
    const locked = h.chunks()[0];
    expect(locked.state).toBe("committed");

    h.lastCloud().d.resolve(cloud(safe("We are those whom God has called.")));
    await settle();

    expect(h.chunks()).toHaveLength(1);
    expect(h.chunks()[0]).toBe(locked);
    expect(h.chunks()[0].text).toBe("We are people God has called.");
    expect(h.stats().contextualDiscardedCommitted).toBe(1);
    expect(h.timings.at(-1)).toMatchObject({ outcome: "discarded" });
  });

  it("keeps the provisional line when the cloud says the same thing", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("We are people God has called."));
    await settle();
    h.lastCloud().d.resolve(cloud(safe("we are people God has called")));
    await settle();
    expect(h.chunks()).toHaveLength(1);
    expect(h.chunks()[0].text).toBe("We are people God has called.");
    expect(h.chunks()[0].provisional).toBe(false);
    expect(h.stats().contextualKept).toBe(1);
  });

  it("never blanks a provisional line with an empty cloud answer", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("We are people God has called."));
    await settle();
    h.lastCloud().d.resolve(cloud({ safeChunks: [], confidence: "low" }, { degraded: true, reason: "quota" }));
    await settle();
    expect(h.texts()).toEqual(["We are people God has called."]);
    expect(h.engine.snapshot().health.llm).toBe("degraded");
  });
});

describe("turn identity", () => {
  it("lets a stale cloud result for turn N touch nothing of turn N+1", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("Turn one provisional."));
    await settle();
    h.say(B);
    h.lastLane().d.resolve(safe("Turn two provisional."));
    await settle();
    // Turn two's arrival locked turn one, as new English always has.
    expect(h.chunks().map((c) => c.state)).toEqual(["committed", "current"]);
    const [one, two] = h.chunks();

    // Cloud for turn one arrives late. Its turn is locked; turn two is not its.
    h.cloudCalls[0].d.resolve(cloud(safe("Turn one rewritten.")));
    await settle();

    expect(h.chunks()[0]).toBe(one);
    expect(h.chunks()[1]).toBe(two);
    expect(h.texts()).toEqual(["Turn one provisional.", "Turn two provisional."]);
    expect(h.stats().contextualDiscardedCommitted).toBe(1);
  });

  it("slots a late on-device result for an older turn ahead of a newer editable turn", async () => {
    const h = harness({ lag: "fast" });
    h.say(A);
    const laneA = h.lastLane();
    // Fast lane single-flight: turn B waits for A's translator call...
    h.say(B);
    expect(h.laneCalls).toHaveLength(1);
    // ...unless A stalls past the fast-lane timeout, in which case B proceeds.
    h.advance(PROVISIONAL_TIMEOUT_MS);
    await settle();
    expect(h.laneCalls).toHaveLength(2);
    expect(laneA.signal.aborted).toBe(true);
    h.lastLane().d.resolve(safe("Turn two."));
    await settle();
    expect(h.texts()).toEqual(["Turn two."]);

    // A's cloud (no provisional existed) lands: it belongs before B while B is editable.
    h.cloudCalls[0].d.resolve(cloud(safe("Turn one.")));
    await settle();
    expect(h.texts()).toEqual(["Turn one.", "Turn two."]);
    expect(h.chunks().map((c) => c.turnId)).toEqual([1, 2]);
    // B's provisional line is still B's and still editable.
    expect(h.chunks()[1].state).toBe("current");
  });

  it("appends rather than reorders when the newer turn has already committed", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(null); // fast lane had nothing for A
    await settle();
    h.say(B);
    h.lastLane().d.resolve(safe("Turn two."));
    await settle();
    h.advance(2_600);
    const lockedB = h.chunks()[0];
    expect(lockedB.state).toBe("committed");

    h.cloudCalls[0].d.resolve(cloud(safe("Turn one.")));
    await settle();
    expect(h.texts()).toEqual(["Turn two.", "Turn one."]);
    expect(h.chunks()[0]).toBe(lockedB);
  });
});

describe("invalidation", () => {
  it("stop invalidates a late on-device result", async () => {
    const h = harness();
    h.say(A);
    const lane = h.lastLane();
    h.engine.stop();
    expect(lane.signal.aborted).toBe(true);
    lane.d.resolve(safe("Too late."));
    await settle();
    expect(h.chunks()).toEqual([]);
    expect(h.stats().provisionalStale).toBe(1);
  });

  it("stop invalidates a late cloud result and leaves committed text alone", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("Provisional stands."));
    await settle();
    const request = h.lastCloud();
    h.engine.stop();
    const final = h.chunks()[0];
    expect(final.state).toBe("committed");
    expect(request.signal.aborted).toBe(true);

    request.d.resolve(cloud(safe("Rewritten after end.")));
    await settle();
    expect(h.chunks()).toHaveLength(1);
    expect(h.chunks()[0]).toBe(final);
    expect(h.stats().contextualStale).toBe(1);
    expect(h.timings.at(-1)).toMatchObject({ lane: "contextual", outcome: "stale" });
  });

  it("a restart changes generation so old results cannot leak into the new session", async () => {
    const h = harness();
    h.say(A);
    const oldLane = h.lastLane();
    const oldCloud = h.lastCloud();
    h.engine.stop();
    h.engine.start();
    h.say(B);
    h.lastLane().d.resolve(safe("New session line."));
    await settle();

    oldLane.d.resolve(safe("Old session provisional."));
    oldCloud.d.resolve(cloud(safe("Old session cloud.")));
    await settle();

    expect(h.texts()).toEqual(["New session line."]);
    expect(h.stats().provisionalStale).toBe(1);
    expect(h.stats().contextualStale).toBe(1);
  });

  it("a mode change invalidates outstanding results without losing the Korean", async () => {
    const h = harness();
    h.say(A);
    const lane = h.lastLane();
    const request = h.lastCloud();
    h.engine.setMode("general");
    expect(lane.signal.aborted).toBe(true);
    expect(request.signal.aborted).toBe(true);

    lane.d.resolve(safe("Sermon-mode provisional."));
    request.d.resolve(cloud(safe("Sermon-mode cloud.")));
    await settle();
    expect(h.chunks()).toEqual([]);

    // The unit is back in front of the stabiliser and re-flushes under general.
    h.advance(100);
    expect(h.cloudCalls).toHaveLength(2);
    expect(h.lastCloud().request.pending).toBe(A);
    expect(h.lastCloud().request.mode).toBe("general");
  });

  it("a lag change does not disturb an in-flight turn", async () => {
    const h = harness();
    h.say(A);
    h.engine.setLag("safe");
    expect(h.lastCloud().signal.aborted).toBe(false);
    h.lastLane().d.resolve(safe("Still here."));
    await settle();
    expect(h.texts()).toEqual(["Still here."]);
  });
});

describe("fallback and loss prevention", () => {
  it("falls back to the cloud result when the translator fails, losing no Korean", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.reject(new Error("translator exploded"));
    await settle();
    expect(h.chunks()).toEqual([]);
    expect(h.stats().provisionalFailed).toBe(1);
    await expect(h.lastCloud().turn.provisionalSettled()).resolves.toBe(false);

    h.lastCloud().d.resolve(cloud(safe("Cloud carried the turn.")));
    await settle();
    expect(h.texts()).toEqual(["Cloud carried the turn."]);
    expect(h.chunks()[0].provisional).toBeUndefined();
    expect(h.engine.snapshot().segments.map((s) => s.text)).toEqual([A]);
  });

  it("restores the Korean when both lanes fail", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(null);
    h.lastCloud().d.reject(new Error("network"));
    await settle();
    expect(h.chunks()).toEqual([]);
    expect(h.engine.snapshot().health.llm).toBe("down");
    // Timeout flush re-sends the same unit as a new turn.
    h.advance(2_600);
    expect(h.cloudCalls).toHaveLength(2);
    expect(h.lastCloud().request.pending).toBe(A);
    expect(h.lastCloud().turn.turnIds).toEqual([2]);
  });

  it("leaves useful provisional English when the cloud fails afterwards", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("Provisional English."));
    await settle();
    await expect(h.lastCloud().turn.provisionalSettled()).resolves.toBe(true);
    h.lastCloud().d.reject(new Error("502"));
    await settle();
    expect(h.texts()).toEqual(["Provisional English."]);
    expect(h.engine.snapshot().health.llm).toBe("down");
    // Nothing to restore: the interpreter already has English for it.
    h.advance(2_600);
    expect(h.cloudCalls).toHaveLength(1);
  });

  it("drops a late on-device result once the cloud already rendered the turn", async () => {
    const h = harness();
    h.say(A);
    h.lastCloud().d.resolve(cloud(safe("Cloud was faster.")));
    await settle();
    expect(h.texts()).toEqual(["Cloud was faster."]);
    h.lastLane().d.resolve(safe("On-device was slower."));
    await settle();
    expect(h.texts()).toEqual(["Cloud was faster."]);
    expect(h.stats().provisionalSuperseded).toBe(1);
  });
});

describe("provisional settlement", () => {
  it("resolves for every fate so a waiting caller never hangs", async () => {
    const h = harness();
    h.say(A);
    const first = h.lastCloud().turn.provisionalSettled();
    h.lastLane().d.resolve(safe("Applied."));
    await expect(first).resolves.toBe(true);
    h.lastCloud().d.resolve(cloud(safe("Applied.")));
    await settle();

    h.say(B);
    expect(h.cloudCalls).toHaveLength(2);
    const second = h.lastCloud().turn.provisionalSettled();
    h.advance(PROVISIONAL_TIMEOUT_MS); // timeout → failed
    await expect(second).resolves.toBe(false);
    h.lastCloud().d.resolve(cloud(safe("Cloud carried B.")));
    await settle();

    h.say(C);
    expect(h.cloudCalls).toHaveLength(3);
    const third = h.lastCloud().turn.provisionalSettled();
    h.engine.stop(); // stale
    await expect(third).resolves.toBe(false);

    const off = harness({ laneReady: false });
    off.say(A);
    await expect(off.lastCloud().turn.provisionalSettled()).resolves.toBe(false);
  });
});

describe("cloud-first when no fast lane is ready", () => {
  it("behaves exactly single-flight without a lane", async () => {
    const h = harness({ lane: false });
    h.say(A);
    expect(h.cloudCalls).toHaveLength(1);
    h.say(B);
    // Second unit waits in the stabiliser buffer while the first is in flight.
    expect(h.cloudCalls).toHaveLength(1);
    h.lastCloud().d.resolve(cloud(safe("One.")));
    await settle();
    h.advance(2_600);
    expect(h.cloudCalls).toHaveLength(2);
    expect(h.lastCloud().request.pending).toBe(B);
    expect(h.chunks().every((c) => c.provisional === undefined)).toBe(true);
  });

  it("does not stall a turn on a translator that is still preparing", async () => {
    const h = harness({ laneReady: false });
    h.say(A);
    expect(h.laneCalls).toHaveLength(0);
    expect(h.cloudCalls).toHaveLength(1);
    h.lastCloud().d.resolve(cloud(safe("Cloud-first.")));
    await settle();
    expect(h.texts()).toEqual(["Cloud-first."]);

    // Ready from the next turn on: two lanes without a restart.
    h.setReady(true);
    h.say(B);
    expect(h.laneCalls).toHaveLength(1);
    h.lastLane().d.resolve(safe("Provisional now."));
    await settle();
    expect(h.texts()).toEqual(["Cloud-first.", "Provisional now."]);
    expect(h.chunks()[1].provisional).toBe(true);
  });
});

describe("bounded cloud lane", () => {
  it("retains later Korean while an earlier cloud request is in flight", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("One."));
    await settle();
    h.say(B);
    h.lastLane().d.resolve(safe("Two."));
    await settle();
    expect(h.texts()).toEqual(["One.", "Two."]);
    // Only one cloud request has been sent; the second turn is queued, not lost.
    expect(h.cloudCalls).toHaveLength(1);
    expect(h.stats().coalescedTurns).toBe(1);

    h.cloudCalls[0].d.resolve(cloud(safe("One refined.")));
    await settle();
    expect(h.cloudCalls).toHaveLength(2);
    expect(h.lastCloud().request.pending).toBe(B);
    expect(h.lastCloud().turn.turnIds).toEqual([2]);
    expect(h.stats().maxCloudInFlight).toBe(1);
  });

  it("coalesces several queued turns into one bounded request", async () => {
    const h = harness();
    const lines = [A, B, C, D, A, B, C, D, A, B];
    for (const [i, line] of lines.entries()) {
      h.say(line);
      h.lastLane().d.resolve(safe(`Line ${i}.`));
      await settle();
    }
    expect(h.cloudCalls).toHaveLength(1);
    expect(h.stats().maxPendingTurns).toBeLessThanOrEqual(MAX_COALESCED_TURNS);
    expect(h.stats().coalesceOverflowDrops).toBe(lines.length - 1 - MAX_COALESCED_TURNS);
    // Every turn's provisional English is on screen regardless.
    expect(h.texts()).toHaveLength(lines.length);

    h.cloudCalls[0].d.resolve(cloud(safe("Line 0 refined.")));
    await settle();
    expect(h.cloudCalls).toHaveLength(2);
    const request = h.lastCloud();
    expect(request.turn.turnIds).toHaveLength(MAX_COALESCED_TURNS);
    expect(request.turn.turnIds).toEqual([5, 6, 7, 8, 9, 10]);
    expect(request.request.pending.length).toBeLessThanOrEqual(4_000);
  });

  it("excludes its own provisional English from the cloud request context", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("Turn one provisional."));
    await settle();
    h.say(B);
    h.lastLane().d.resolve(safe("Turn two provisional."));
    await settle();
    h.cloudCalls[0].d.resolve(cloud(safe("Turn one provisional.")));
    await settle();
    const context = h.lastCloud().request.context;
    expect(context.recentEnglish).toContain("Turn one provisional.");
    expect(context.recentEnglish).not.toContain("Turn two provisional.");
  });
});

describe("chunk-store semantics under refinement", () => {
  it("still suppresses an accidental duplicate of an earlier line", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("God has called us."));
    await settle();
    h.lastCloud().d.resolve(cloud(safe("God has called us.")));
    await settle();
    h.say(B);
    h.lastLane().d.resolve(safe("Love one another."));
    await settle();
    h.lastCloud().d.resolve(cloud(safe("God has called us.", "Love one another today.")));
    await settle();
    expect(h.texts()).toEqual(["God has called us.", "Love one another today."]);
  });

  it("preserves deliberate repetition inside one refinement", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("God is faithful."));
    await settle();
    h.lastCloud().d.resolve(cloud(safe("God is faithful.", "God is faithful.", "God is faithful.")));
    await settle();
    expect(h.texts()).toEqual(["God is faithful.", "God is faithful.", "God is faithful."]);
  });

  it("keeps committed chunks byte-for-byte across every later event", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("Locked line."));
    await settle();
    h.advance(2_600);
    const locked = h.chunks()[0];
    const frozen = JSON.stringify(locked);

    h.lastCloud().d.resolve(cloud(safe("Locked line, rewritten.")));
    await settle();
    h.say(B);
    h.lastLane().d.resolve(safe("Next line."));
    await settle();
    h.lastCloud().d.resolve(cloud(safe("Locked line."), { degraded: true }));
    await settle();
    h.engine.stop();

    expect(h.chunks()[0]).toBe(locked);
    expect(JSON.stringify(h.chunks()[0])).toBe(frozen);
  });
});

describe("memory trust", () => {
  it("never lets provisional output teach glossary, entity or Scripture memory", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve({
      safeChunks: [{ text: "Provisional.", confidence: "medium" }],
      glossary: [{ korean: "부르심", english: "vocation" }],
      entities: [{ korean: "하나님", english: "Hananim", kind: "person" }],
      bibleReferences: [{ book: "Romans", chapter: 8, verse: 28, display: "Romans 8:28", confidence: "high" }],
      topic: "guessed topic",
      confidence: "medium",
    });
    await settle();
    const snapshot = h.engine.snapshot();
    expect(snapshot.glossary.some((g) => g.english === "vocation")).toBe(false);
    expect(snapshot.entities.some((e) => e.english === "Hananim")).toBe(false);
    expect(snapshot.scripture.some((r) => r.display === "Romans 8:28")).toBe(false);
    expect(snapshot.topic).toBeUndefined();
  });

  it("absorbs contextual knowledge even when its chunks were discarded after commit", async () => {
    const h = harness();
    h.say(A);
    h.lastLane().d.resolve(safe("Provisional."));
    await settle();
    h.advance(2_600);
    h.lastCloud().d.resolve(
      cloud({
        safeChunks: [{ text: "Rewrite.", confidence: "high" }],
        glossary: [{ korean: "부르심", english: "calling" }],
        entities: [{ korean: "바울", english: "Paul", kind: "person" }],
        topic: "Called by God",
        confidence: "high",
      }),
    );
    await settle();
    const snapshot = h.engine.snapshot();
    expect(snapshot.chunks.map((c) => c.text)).toEqual(["Provisional."]);
    expect(snapshot.glossary.some((g) => g.english === "calling")).toBe(true);
    expect(snapshot.entities.some((e) => e.english === "Paul")).toBe(true);
    expect(snapshot.topic).toBe("Called by God");
  });
});

describe("anticipation with provisional chunks", () => {
  const OPEN = "제가 오늘 여러분과 함께 나누고 싶은 것은";

  function openThought(h: ReturnType<typeof harness>) {
    h.engine.handleStable(OPEN);
    h.engine.handlePartial("바로 우리의 정체성");
    // Balanced: quiet after 900ms triggers a mid-thought flush.
    h.advance(900);
  }

  it("applies a prediction only for the newest turn and clears it on the next provisional", async () => {
    const h = harness();
    openThought(h);
    expect(h.lastCloud().request.allowAnticipation).toBe(true);
    h.lastLane().d.resolve(safe("Today I'd like to talk with you about..."));
    await settle();
    h.lastCloud().d.resolve(
      cloud({
        safeChunks: [{ text: "Today I'd like to share with you...", confidence: "high" }],
        anticipatedChunks: [{ text: "our identity.", confidence: "low" }],
        confidence: "high",
      }),
    );
    await settle();
    expect(h.chunks().map((c) => c.state)).toEqual(["current", "anticipated"]);

    h.say(A);
    h.lastLane().d.resolve(safe("We are people God has called."));
    await settle();
    expect(h.chunks().map((c) => c.state)).toEqual(["committed", "current"]);
    expect(h.chunks().some((c) => c.state === "anticipated")).toBe(false);
  });

  it("ignores a prediction from an older turn once a newer turn exists", async () => {
    const h = harness();
    openThought(h);
    h.lastLane().d.resolve(safe("Today I'd like to talk with you about..."));
    await settle();
    h.say(A);
    h.lastLane().d.resolve(safe("We are people God has called."));
    await settle();
    h.cloudCalls[0].d.resolve(
      cloud({
        safeChunks: [{ text: "Today I'd like to share...", confidence: "high" }],
        anticipatedChunks: [{ text: "our identity.", confidence: "low" }],
        confidence: "high",
      }),
    );
    await settle();
    expect(h.chunks().some((c) => c.state === "anticipated")).toBe(false);
    expect(h.texts()).toEqual(["Today I'd like to talk with you about...", "We are people God has called."]);
  });
});

describe("shutdown flush", () => {
  it("flushPending drives both lanes for the final unit", async () => {
    const h = harness();
    h.engine.handleStable("우리는 함께");
    const done = h.engine.flushPending();
    expect(h.laneCalls).toHaveLength(1);
    expect(h.cloudCalls).toHaveLength(1);
    h.lastLane().d.resolve(safe("Together we"));
    h.lastCloud().d.resolve(cloud(safe("We, together,")));
    await done;
    expect(h.texts()).toEqual(["We, together,"]);
  });
});
