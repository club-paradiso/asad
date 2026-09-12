import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InterpretationEngine,
  __resetSegmentIds,
  type EngineSnapshot,
} from "@/interpreter/engine/session";
import { __resetChunkIds } from "@/interpreter/engine/chunks";
import type { InterpretRequest } from "@/lib/schema";

const output = (text: string) => ({
  safeChunks: [{ text, confidence: "high" as const }],
  confidence: "high" as const,
});

beforeEach(() => {
  __resetChunkIds();
  __resetSegmentIds();
});

describe("live interpretation reliability", () => {
  /**
   * WebKit finalises the full stop as a result of its own, a beat after the
   * words. The Korean pane shows four lines; a line containing only "." spends
   * one of them, and pushes a real sentence off the top of the only surface the
   * interpreter uses to check what they half-heard.
   */
  it("folds a punctuation-only stable result into the sentence it terminates", () => {
    let snapshot: EngineSnapshot | null = null;
    const engine = new InterpretationEngine({
      mode: "sermon",
      lag: "balanced",
      now: () => 0,
      onChange: (next) => {
        snapshot = next;
      },
      interpret: async () => ({ output: output("English") }),
    });

    engine.start();
    engine.handleStable("오늘 본문은 요한복음 3장 16절");
    engine.handleStable(".");

    const state = snapshot as unknown as EngineSnapshot;
    expect(state.segments.map((segment) => segment.text)).toEqual([
      "오늘 본문은 요한복음 3장 16절.",
    ]);
  });

  it("keeps a punctuation-only result as its own segment when nothing precedes it", () => {
    let snapshot: EngineSnapshot | null = null;
    const engine = new InterpretationEngine({
      mode: "sermon",
      lag: "balanced",
      now: () => 0,
      onChange: (next) => {
        snapshot = next;
      },
      interpret: async () => ({ output: output("English") }),
    });

    engine.start();
    engine.handleStable(".");

    const state = snapshot as unknown as EngineSnapshot;
    expect(state.segments).toHaveLength(1);
  });

  it("restores a failed interpretation unit in front of newer speech", async () => {
    let now = 0;
    let snapshot: EngineSnapshot | null = null;
    const pending: string[] = [];
    let calls = 0;

    const engine = new InterpretationEngine({
      mode: "sermon",
      lag: "balanced",
      now: () => now,
      onChange: (next) => {
        snapshot = next;
      },
      interpret: async (request: InterpretRequest) => {
        pending.push(request.pending);
        calls += 1;
        if (calls === 1) throw new Error("temporary network failure");
        return { output: output("Recovered English") };
      },
    });

    engine.start();
    engine.handleStable("첫 번째 문장은 절대로 사라지면 안 됩니다.");
    now += 3000;
    engine.tick();
    await vi.waitFor(() => expect(snapshot?.thinking).toBe(false));

    const failedState = snapshot as unknown as EngineSnapshot;
    expect(pending).toEqual(["첫 번째 문장은 절대로 사라지면 안 됩니다."]);
    expect(failedState.health.llm).toBe("down");

    engine.handleStable("두 번째 문장도 이어집니다.");
    now += 3000;
    engine.tick();
    await vi.waitFor(() => expect(snapshot?.thinking).toBe(false));

    const recoveredState = snapshot as unknown as EngineSnapshot;
    expect(pending).toHaveLength(2);
    expect(pending[1]).toContain("첫 번째 문장은 절대로 사라지면 안 됩니다.");
    expect(pending[1]).toContain("두 번째 문장도 이어집니다.");
    expect(recoveredState.chunks.some((chunk) => chunk.text === "Recovered English")).toBe(true);
  });

  it("measures one turn from the original stable event without server clock math", async () => {
    let now = 1000;
    let timing: import("@/interpreter/engine/session").TurnTiming | null = null;
    const engine = new InterpretationEngine({
      mode: "sermon", lag: "balanced", now: () => now, onChange: () => {},
      onTurnTiming: (next) => { timing = next; },
      interpret: async () => ({ output: output("Measured English"), clientDispatchedAt: now, provider: "test-provider", model: "test-model" }),
    });
    engine.start();
    engine.handleStable("이 문장은 안정화 시점부터 측정됩니다.");
    now += 900;
    engine.tick();
    await vi.waitFor(() => expect(timing).not.toBeNull());
    const measured = timing as unknown as import("@/interpreter/engine/session").TurnTiming;
    expect(measured.stableAt).toBe(1000);
    expect(measured.clientDispatchedAt).toBe(1900);
    expect(measured.safeAt).toBe(1900);
    expect(measured.hasSafe).toBe(true);
    expect(measured.provider).toBe("test-provider");
  });

  it("flushes final stable speech immediately during graceful shutdown", async () => {
    const now = 0;
    let snapshot: EngineSnapshot | null = null;
    const pending: string[] = [];

    const engine = new InterpretationEngine({
      mode: "sermon",
      lag: "safe",
      now: () => now,
      onChange: (next) => {
        snapshot = next;
      },
      interpret: async (request: InterpretRequest) => {
        pending.push(request.pending);
        return { output: output("Final English") };
      },
    });

    engine.start();
    engine.handleStable("그리고 이것이 마지막으로 꼭 전달해야 할 말");

    // Safe mode would normally wait several seconds. End should not require
    // the interpreter to stare at the console waiting for that timer.
    await engine.flushPending();

    const finalState = snapshot as unknown as EngineSnapshot;
    expect(pending).toEqual(["그리고 이것이 마지막으로 꼭 전달해야 할 말"]);
    expect(finalState.chunks.some((chunk) => chunk.text === "Final English")).toBe(true);
  });
});
