/**
 * What the engine does with the two things it learned in this change: what the
 * setting is, and how a name is spelled.
 *
 * Both are session properties rather than sentence properties, which is why
 * they live in the engine and not in a prompt.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { InterpretRequest } from "@/lib/schema";
import type { InterpreterOutput, LagProfile } from "@/types";
import { emptyPrepSheet, type PrepSheet } from "@/types";
import {
  InterpretationEngine,
  __resetSegmentIds,
  type ContextualTurnInfo,
  type InterpretResult,
} from "./session";
import { __resetChunkIds } from "./chunks";

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

function harness(
  options: {
    context?: Parameters<typeof InterpretationEngine.prototype.setContextMode>[0];
    prep?: PrepSheet;
    lag?: LagProfile;
    source?: string;
    target?: string;
  } = {},
) {
  __resetChunkIds();
  __resetSegmentIds();
  let now = 10_000;

  const cloudCalls: Array<{
    request: InterpretRequest;
    signal: AbortSignal;
    turn: ContextualTurnInfo;
    d: Deferred<InterpretResult>;
  }> = [];

  const engine = new InterpretationEngine({
    context: options.context ?? "auto",
    source: options.source,
    target: options.target,
    lag: options.lag ?? "balanced",
    prep: options.prep ?? emptyPrepSheet(),
    now: () => now,
    onChange: () => {},
    interpret: (request, signal, turn) => {
      const d = deferred<InterpretResult>();
      cloudCalls.push({ request, signal, turn, d });
      return d.promise;
    },
  });
  engine.start();

  return {
    engine,
    cloudCalls,
    say: (text: string) => {
      engine.handleStable(text);
      engine.tick();
    },
    advance: (ms: number) => {
      now += ms;
      engine.tick();
    },
    texts: () => engine.snapshot().chunks.map((c) => c.text),
    context: () => engine.snapshot().context,
    lastCloud: () => cloudCalls[cloudCalls.length - 1],
  };
}

beforeEach(() => {
  __resetChunkIds();
  __resetSegmentIds();
});

describe("the language pair crosses the wire", () => {
  it("sends the pair the session was started on", async () => {
    const h = harness({ source: "ko-KR", target: "zh-TW" });
    h.say("우리는 오늘 함께 예배합니다.");
    expect(h.lastCloud().request.source).toBe("ko-KR");
    expect(h.lastCloud().request.target).toBe("zh-TW");
  });

  it("defaults to Korean → English when none was given", () => {
    const h = harness();
    h.say("우리는 오늘 함께 모였습니다.");
    expect(h.lastCloud().request.source).toBe("ko-KR");
    expect(h.lastCloud().request.target).toBe("en-US");
  });

  it("treats a pair change as a new contract and does not lose the speech", async () => {
    const h = harness();
    h.say("우리는 오늘 함께 모였습니다.");
    const first = h.lastCloud();
    h.engine.setLanguages("ko-KR", "ja-JP");
    expect(first.signal.aborted).toBe(true);

    first.d.resolve({ output: safe("We met today.") });
    await settle();
    expect(h.texts()).toEqual([]);

    h.advance(100);
    expect(h.cloudCalls).toHaveLength(2);
    expect(h.lastCloud().request.pending).toBe("우리는 오늘 함께 모였습니다.");
    expect(h.lastCloud().request.target).toBe("ja-JP");
  });
});

describe("context reaches the request", () => {
  it("starts generic and sends generic", () => {
    const h = harness();
    h.say("네, 그러면 그렇게 진행하겠습니다.");
    expect(h.lastCloud().request.context).toBe("generic");
    expect(h.context().mode).toBe("auto");
  });

  it("specialises from the speech itself, with no extra model call", async () => {
    const h = harness();
    h.say("오늘 본문은 요한복음 3장 16절 말씀입니다. 하나님의 은혜와 사랑을 함께 나누겠습니다.");
    h.lastCloud().d.resolve({ output: safe("Today's passage is John 3:16.") });
    await settle();
    h.say("성도 여러분, 아멘 하시겠습니다. 함께 기도하겠습니다. 주님의 은혜가 충만하시기를 바랍니다.");
    h.lastCloud().d.resolve({ output: safe("Brothers and sisters, can I get an amen?") });
    await settle();

    expect(h.context().resolved).toBe("worship");
    // One request per flushed unit and not one more: inference is free.
    expect(h.cloudCalls).toHaveLength(2);
  });

  it("carries the resolved context on the NEXT request rather than restarting this one", async () => {
    const h = harness();
    h.say("오늘 본문은 요한복음 3장 16절 말씀입니다. 하나님의 은혜와 사랑을 나누겠습니다.");
    const first = h.lastCloud();
    h.say("성도 여러분, 아멘 하시겠습니다. 함께 기도하겠습니다. 주님의 은혜가 충만하시기를.");

    // Automatic resolution must never abort work that is about to answer.
    expect(first.signal.aborted).toBe(false);
    first.d.resolve({ output: safe("Today's passage is John 3:16.") });
    await settle();
    expect(h.texts()).toContain("Today's passage is John 3:16.");
  });

  it("absorbs the model's own read from a response it already sent", async () => {
    const h = harness();
    h.say("자, 그러면 시작하겠습니다.");
    h.lastCloud().d.resolve({
      output: { ...safe("Right, let's begin."), context: "meeting" },
    });
    await settle();
    h.say("그 부분은 확인해 보겠습니다.");
    h.lastCloud().d.resolve({
      output: { ...safe("I'll check that."), context: "meeting" },
    });
    await settle();
    expect(h.context().inferred).toBe("meeting");
  });

  it("lets a manual override win and reports full confidence", () => {
    const h = harness({ context: "lecture" });
    h.say("오늘 본문은 요한복음 3장 16절 말씀입니다. 하나님의 은혜를 나누겠습니다.");
    expect(h.lastCloud().request.context).toBe("lecture");
    expect(h.context().confidence).toBe(1);
  });
});

describe("proper nouns stop drifting", () => {
  const prep = (): PrepSheet => ({
    ...emptyPrepSheet(),
    entities: [{ korean: "류정길", english: "Ryu Jeong-gil", kind: "person" }],
  });

  it("rewrites a drifted spelling to the form the session already settled", async () => {
    const h = harness({ prep: prep() });
    h.say("오늘 말씀은 류정길 목사님께서 전해 주시겠습니다.");
    h.lastCloud().d.resolve({
      output: safe("Today's message is brought by Pastor Ryu Jung-gil."),
    });
    await settle();
    expect(h.texts()).toEqual(["Today's message is brought by Pastor Ryu Jeong-gil."]);
  });

  it("leaves a correctly spelled line exactly as the model wrote it", async () => {
    const h = harness({ prep: prep() });
    h.say("오늘 말씀은 류정길 목사님께서 전해 주시겠습니다.");
    const text = "Pastor Ryu Jeong-gil will bring today's message.";
    h.lastCloud().d.resolve({ output: safe(text) });
    await settle();
    expect(h.texts()).toEqual([text]);
  });

  it("honours a correction the interpreter typed over anything the model says", async () => {
    const h = harness();
    h.engine.correct("유정기", "류정길", "Ryu Jeong-gil");
    h.say("오늘 말씀은 유정기 목사님께서 전해 주시겠습니다.");
    // The correction rewrites the source before anything downstream sees it.
    expect(h.lastCloud().request.pending).toContain("류정길");

    h.lastCloud().d.resolve({ output: safe("Pastor Yu Jeong-gil is speaking today.") });
    await settle();
    expect(h.texts()).toEqual(["Pastor Ryu Jeong-gil is speaking today."]);
  });

  it("does not touch a different person with a similar name", async () => {
    const h = harness({ prep: prep() });
    h.say("김정길 집사님도 함께하셨습니다.");
    h.lastCloud().d.resolve({ output: safe("Deacon Kim Jeong-gil was there too.") });
    await settle();
    expect(h.texts()).toEqual(["Deacon Kim Jeong-gil was there too."]);
  });

  it("counts what it fixed, without keeping any of the words", async () => {
    const h = harness({ prep: prep() });
    h.say("류정길 목사님이 말씀하십니다.");
    h.lastCloud().d.resolve({ output: safe("Pastor Ryu Jung-gil is speaking.") });
    await settle();
    expect(h.engine.laneStats().terminologyFixes).toBe(1);
  });
});
