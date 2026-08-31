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

    expect(pending).toEqual(["첫 번째 문장은 절대로 사라지면 안 됩니다."]);
    expect(snapshot?.health.llm).toBe("down");

    engine.handleStable("두 번째 문장도 이어집니다.");
    now += 3000;
    engine.tick();
    await vi.waitFor(() => expect(snapshot?.thinking).toBe(false));

    expect(pending).toHaveLength(2);
    expect(pending[1]).toContain("첫 번째 문장은 절대로 사라지면 안 됩니다.");
    expect(pending[1]).toContain("두 번째 문장도 이어집니다.");
    expect(snapshot?.chunks.some((chunk) => chunk.text === "Recovered English")).toBe(true);
  });

  it("flushes final stable speech immediately during graceful shutdown", async () => {
    let now = 0;
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

    expect(pending).toEqual(["그리고 이것이 마지막으로 꼭 전달해야 할 말"]);
    expect(snapshot?.chunks.some((chunk) => chunk.text === "Final English")).toBe(true);
  });
});
