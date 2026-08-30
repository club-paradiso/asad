import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPrepSheet } from "@/types";
import type { EngineSnapshot } from "@/interpreter/engine/session";
import { useRescueCue } from "./useRescueCue";

const { requestRescueMock } = vi.hoisted(() => ({
  requestRescueMock: vi.fn(),
}));

vi.mock("./rescue-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rescue-client")>();
  return { ...actual, requestRescue: requestRescueMock };
});

const snapshot = (segmentAt = 9_000): EngineSnapshot => ({
  segments: [{ id: "s1", text: "하나님은 우리를 사랑하십니다", at: segmentAt }],
  partial: null,
  chunks: [],
  scripture: [],
  glossary: [],
  culturalNotes: [],
  entities: [],
  corrections: [],
  connection: "live",
  health: { stt: "ok", llm: "ok", bible: "ok" },
  thinking: false,
});

const success = (text = "God loves us.") => ({
  output: {
    safeChunks: [{ text, confidence: "high" as const }],
    confidence: "high" as const,
  },
  provider: "openrouter",
  model: "test-model",
});

describe("useRescueCue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T06:30:10.000Z"));
    requestRescueMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a validated recovery cue and clears it automatically", async () => {
    requestRescueMock.mockResolvedValue(success());
    const startedAt = Date.now() - 10_000;
    const { result } = renderHook(() =>
      useRescueCue({
        snapshot: snapshot(),
        mode: "sermon",
        prep: emptyPrepSheet(),
        startedAt,
        visibleMs: 3_000,
      }),
    );

    await act(async () => {
      await result.current.trigger();
    });

    expect(result.current.state).toMatchObject({
      phase: "showing",
      chunks: ["God loves us."],
      confidence: "high",
      provider: "openrouter",
    });

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.state).toEqual({ phase: "idle", chunks: [] });
  });

  it("does not call Rescue when the stable Korean window is stale", async () => {
    const startedAt = Date.now() - 30_000;
    const { result } = renderHook(() =>
      useRescueCue({
        snapshot: snapshot(1_000),
        mode: "sermon",
        prep: emptyPrepSheet(),
        startedAt,
      }),
    );

    await act(async () => {
      await result.current.trigger();
    });

    expect(requestRescueMock).not.toHaveBeenCalled();
    expect(result.current.state.phase).toBe("unavailable");
    expect(result.current.state.reason).toMatch(/No recent stable Korean/i);
  });

  it("aborts the previous Rescue request when the interpreter taps again", async () => {
    const signals: AbortSignal[] = [];
    let resolveFirst!: (value: ReturnType<typeof success>) => void;
    const first = new Promise<ReturnType<typeof success>>((resolve) => {
      resolveFirst = resolve;
    });

    requestRescueMock
      .mockImplementationOnce((_request, signal: AbortSignal) => {
        signals.push(signal);
        return first;
      })
      .mockImplementationOnce((_request, signal: AbortSignal) => {
        signals.push(signal);
        return Promise.resolve(success("Stay with the current point."));
      });

    const startedAt = Date.now() - 10_000;
    const { result } = renderHook(() =>
      useRescueCue({
        snapshot: snapshot(),
        mode: "sermon",
        prep: emptyPrepSheet(),
        startedAt,
      }),
    );

    let firstTrigger!: Promise<boolean>;
    act(() => {
      firstTrigger = result.current.trigger();
    });

    await act(async () => {
      await result.current.trigger();
    });

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(result.current.state.chunks).toEqual(["Stay with the current point."]);

    await act(async () => {
      resolveFirst(success("Stale cue that must not win."));
      await firstTrigger;
    });
    expect(result.current.state.chunks).toEqual(["Stay with the current point."]);
  });

  it("dismisses a loading Rescue by aborting it and ignoring its late response", async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveRequest!: (value: ReturnType<typeof success>) => void;
    const pending = new Promise<ReturnType<typeof success>>((resolve) => {
      resolveRequest = resolve;
    });
    requestRescueMock.mockImplementation((_request, signal: AbortSignal) => {
      capturedSignal = signal;
      return pending;
    });

    const startedAt = Date.now() - 10_000;
    const { result } = renderHook(() =>
      useRescueCue({
        snapshot: snapshot(),
        mode: "sermon",
        prep: emptyPrepSheet(),
        startedAt,
      }),
    );

    let trigger!: Promise<boolean>;
    act(() => {
      trigger = result.current.trigger();
    });
    expect(result.current.state.phase).toBe("loading");

    act(() => {
      result.current.clear();
    });
    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.state).toEqual({ phase: "idle", chunks: [] });

    await act(async () => {
      resolveRequest(success("This late cue must stay dismissed."));
      await trigger;
    });
    expect(result.current.state).toEqual({ phase: "idle", chunks: [] });
  });

  it("aborts an in-flight Rescue request on unmount", () => {
    let capturedSignal: AbortSignal | undefined;
    requestRescueMock.mockImplementation((_request, signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });

    const startedAt = Date.now() - 10_000;
    const { result, unmount } = renderHook(() =>
      useRescueCue({
        snapshot: snapshot(),
        mode: "sermon",
        prep: emptyPrepSheet(),
        startedAt,
      }),
    );

    act(() => {
      void result.current.trigger();
    });
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
