/**
 * The critical acceptance test from the product brief.
 *
 * Runs the real engine end-to-end — the real stabiliser, the real chunk store,
 * the real local interpretation path — against the two cases the product is
 * required to handle convincingly, and asserts the specific failure the brief
 * names as disqualifying.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InterpretRequest } from "@/lib/schema";
import {
  InterpretationEngine,
  __resetSegmentIds,
  type EngineSnapshot,
  type InterpretResult,
} from "@/interpreter/engine/session";
import { __resetChunkIds } from "@/interpreter/engine/chunks";
import { interpretLocally } from "@/providers/llm/mock";
import { SERMON_DEMO } from "@/demo/sermon-script";
import { emptyPrepSheet } from "@/types";

/** Drives the engine on a controllable clock. */
function harness(options: { lag?: "fast" | "balanced" | "safe" } = {}) {
  __resetChunkIds();
  __resetSegmentIds();

  let now = 0;
  let snapshot: EngineSnapshot | null = null;
  const requests: InterpretRequest[] = [];

  const engine = new InterpretationEngine({
    mode: "sermon",
    lag: options.lag ?? "balanced",
    prep: {
      ...emptyPrepSheet(),
      speaker: SERMON_DEMO.speaker,
      scripture: SERMON_DEMO.scripture,
      title: SERMON_DEMO.title,
    },
    now: () => now,
    onChange: (next) => {
      snapshot = next;
    },
    interpret: async (request: InterpretRequest): Promise<InterpretResult> => {
      requests.push(request);
      return {
        output: interpretLocally({
          pending: request.pending,
          mode: request.mode,
          scriptId: SERMON_DEMO.id,
          allowAnticipation: request.allowAnticipation,
        }),
      };
    },
  });

  engine.start();

  /** Speak a line, then let the clock run so the engine flushes. */
  const say = async (korean: string, advanceMs = 3000) => {
    engine.handleStable(korean);
    now += advanceMs;
    engine.tick();
    // Let the (async) interpretation promise settle.
    await vi.waitFor(() => expect(snapshot?.thinking).toBe(false), { timeout: 1000 });
  };

  return {
    engine,
    say,
    requests,
    advance: (ms: number) => {
      now += ms;
      engine.tick();
    },
    get snapshot() {
      if (!snapshot) throw new Error("engine produced no snapshot");
      return snapshot;
    },
    get english() {
      return this.snapshot.chunks
        .filter((c) => c.state !== "anticipated")
        .map((c) => c.text);
    },
  };
}

beforeEach(() => {
  __resetChunkIds();
  __resetSegmentIds();
});

describe("acceptance · Scripture announcement", () => {
  it("produces the expected interpreter-ready English and the reference", async () => {
    const h = harness();
    await h.say("우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.");

    expect(h.english).toEqual([
      "Today we're going to look at...",
      "1 Peter 2:9.",
    ]);
  });

  it("puts the reference in its own chunk, the way it is actually delivered", async () => {
    const h = harness();
    await h.say("우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.");
    expect(h.english[1]).toBe("1 Peter 2:9.");
  });

  it("surfaces the normalised reference in the context rail", async () => {
    const h = harness();
    await h.say("우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.");

    expect(h.snapshot.scripture.map((r) => r.display)).toContain("1 Peter 2:9");
    const reference = h.snapshot.scripture.find((r) => r.display === "1 Peter 2:9");
    expect(reference?.book).toBe("1 Peter");
    expect(reference?.confidence).toBe("high");
  });

  it("never invents verse wording", async () => {
    const h = harness();
    await h.say("우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.");
    // No Bible provider was wired in, so there must be no text at all.
    expect(h.snapshot.scripture.every((r) => r.text === undefined)).toBe(true);
    expect(h.english.join(" ")).not.toMatch(/chosen (people|race)/i);
  });
});

describe("acceptance · name wordplay", () => {
  const LINE = "그래서 우리는 길을 잘 찾아야 됩니다. 제 이름에도 길이 있어요.";

  it("adapts the pun instead of translating it literally", async () => {
    const h = harness();
    await h.say(LINE);

    expect(h.english).toEqual([
      "So we need to find the right way.",
      'And speaking of "the way," it\'s even in my name.',
    ]);
  });

  it("fails the brief's explicit quality failure", async () => {
    const h = harness();
    await h.say(LINE);

    const joined = h.english.join(" ").toLowerCase();
    // "There is a road in my name." is named in the brief as a failed test.
    expect(joined).not.toContain("road in my name");
    expect(joined).not.toContain("find the road well");
  });

  it("marks the adapted line so the interpreter can see it is not literal", async () => {
    const h = harness();
    await h.say(LINE);

    const adapted = h.snapshot.chunks.find((c) => c.adapted);
    expect(adapted).toBeDefined();
    expect(adapted?.text).toContain("even in my name");
    expect(adapted?.note).toBeTruthy();
  });

  it("offers the cultural note", async () => {
    const h = harness();
    await h.say(LINE);

    const note = h.snapshot.culturalNotes.find((n) => n.kind === "wordplay");
    expect(note).toBeDefined();
    expect(note?.note.toLowerCase()).toContain("way");
  });

  it("detects the pun locally even before the model answers", () => {
    const h = harness();
    // No tick, so no interpretation call has happened yet.
    h.engine.handleStable(LINE);
    expect(h.snapshot.culturalNotes.some((n) => n.kind === "wordplay")).toBe(true);
  });
});

describe("acceptance · the session as a whole", () => {
  it("runs the scripted sermon without losing the Korean transcript", async () => {
    const h = harness();
    for (const beat of SERMON_DEMO.beats.slice(0, 6)) {
      await h.say(beat.korean);
    }
    expect(h.snapshot.segments).toHaveLength(6);
    expect(h.english.length).toBeGreaterThan(6);
  });

  it("chunks a very long sentence into breath groups", async () => {
    const h = harness();
    await h.say(
      "베드로 사도는 우리를 가리켜서 택하신 족속이요, 왕 같은 제사장들이요, 거룩한 나라요, 그의 소유가 된 백성이라고 말씀하고 있습니다.",
    );
    expect(h.english).toEqual([
      "Peter calls us...",
      "a chosen people,",
      "a royal priesthood,",
      "a holy nation,",
      "God's special possession.",
    ]);
    // Every chunk stays inside a breath group.
    for (const text of h.english) expect(text.split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it("preserves intentional rhetorical repetition", async () => {
    const h = harness();
    await h.say(
      "여러분은 택하신 족속입니다. 여러분은 왕 같은 제사장입니다. 여러분은 거룩한 나라입니다.",
    );
    expect(h.english.filter((line) => line.startsWith("You are"))).toHaveLength(3);
  });

  it("compresses rhetorical padding", async () => {
    const h = harness();
    await h.say(
      "제가 여러분에게 다시 한번 꼭 말씀드리고 싶은 것은, 이 부르심이 우리의 노력으로 된 것이 아니라는 것입니다.",
    );
    expect(h.english[0]).toBe("Let me emphasise this again:");
  });

  it("marks an uncertain number as low confidence rather than guessing", async () => {
    const h = harness();
    await h.say("제가 처음 이 교회에 왔을 때, 한 삼천... 아니, 삼백 명 정도가 모였습니다.");
    expect(h.snapshot.chunks.some((c) => c.confidence === "low")).toBe(true);
  });
});

describe("interpreter corrections are absolute", () => {
  it("rewrites the transcript and every future mention", async () => {
    const h = harness();
    h.engine.handleStable("저는 오늘 말씀을 전하게 된 유정길 목사입니다.");
    h.engine.correct("유정길", "류정길");

    expect(h.snapshot.segments[0].text).toContain("류정길");
    expect(h.snapshot.segments[0].corrected).toBe(true);
    expect(h.snapshot.segments[0].originalText).toContain("유정길");

    // A later recognition of the wrong form is corrected before anything sees it.
    h.engine.handleStable("유정길 목사님이 기도하시겠습니다.");
    expect(h.snapshot.segments[1].text).toContain("류정길");
    expect(h.snapshot.segments[1].text).not.toContain("유정길");
  });

  it("binds the interpreter's preferred romanisation", () => {
    const h = harness();
    h.engine.correct("유정길", "류정길");
    const entity = h.snapshot.entities.find((e) => e.korean === "류정길");
    expect(entity?.english).toBe("Ryu Jeong-gil");
  });

  it("carries corrections into the model's context", async () => {
    const h = harness();
    h.engine.correct("유정길", "류정길");
    await h.say("우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.");

    const correction = h.requests[0].context.corrections.find((c) => c.from === "유정길");
    expect(correction?.to).toBe("류정길");
    expect(correction?.english).toBe("Ryu Jeong-gil");
  });
});

describe("subsystem failure never ends the session", () => {
  it("keeps the Korean transcript when interpretation dies", async () => {
    __resetChunkIds();
    __resetSegmentIds();
    let now = 0;
    let snapshot: EngineSnapshot | null = null;

    const engine = new InterpretationEngine({
      mode: "sermon",
      lag: "balanced",
      now: () => now,
      onChange: (next) => {
        snapshot = next;
      },
      interpret: async () => {
        throw new Error("model unavailable");
      },
    });
    engine.start();
    engine.handleStable("우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.");
    now += 3000;
    engine.tick();
    await vi.waitFor(() => expect(snapshot?.health.llm).toBe("down"), { timeout: 1000 });

    const state = snapshot as unknown as EngineSnapshot;
    // The console still has everything that does not need the model.
    expect(state.segments).toHaveLength(1);
    expect(state.scripture.map((r) => r.display)).toContain("1 Peter 2:9");
    expect(state.health.stt).toBe("ok");
    expect(state.degradedReason).toContain("model unavailable");
  });
});
