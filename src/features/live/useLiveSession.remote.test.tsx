import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeechProvider, SttStatus } from "@/providers/stt";
import { FakeStream, FakeTrack } from "@/test/fake-webrtc";

/**
 * Remote Microphone → the EXISTING live pipeline.
 *
 * What these pin down is the architectural contract: the paired phone's
 * MediaStream is handed to the same `MicrophoneCapture` every other raw input
 * uses (so the 16 kHz PCM16 conversion, input-health metering and frame
 * delivery are unchanged), frames reach the selected recogniser, and the
 * engine receives partial and stable text — with no second pipeline, no
 * getUserMedia on the MacBook, and no silent fallback to anything else.
 */

const captures = vi.hoisted(() => [] as Array<{ options: Record<string, unknown>; started: boolean; stopped: boolean }>);
const providers = vi.hoisted(() => [] as Array<FakeProvider>);

interface FakeProvider extends SpeechProvider {
  sent: ArrayBuffer[];
  emitPartial(text: string): void;
  emitStable(text: string): void;
}

vi.mock("@/providers/stt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/stt")>();
  class FakeCapture {
    static isSupported() {
      return true;
    }
    readonly record: { options: Record<string, unknown>; started: boolean; stopped: boolean };
    constructor(readonly options: Record<string, unknown>) {
      this.record = { options, started: false, stopped: false };
      captures.push(this.record);
    }
    async start() {
      this.record.started = true;
    }
    async stop() {
      this.record.stopped = true;
    }
    trackInfo() {
      return { label: "remote-track-uuid" };
    }
  }
  return {
    ...actual,
    MicrophoneCapture: FakeCapture,
    fetchSttCredentials: vi.fn(async () => ({ provider: "deepgram", token: "temporary-token" })),
    createSpeechProvider: vi.fn((options: { provider: string }) => {
      const handlers: {
        partial?: (text: string) => void;
        stable?: (text: string) => void;
        status?: (status: SttStatus, detail?: string) => void;
      } = {};
      const provider: FakeProvider = {
        id: options.provider as FakeProvider["id"],
        needsAudio: options.provider !== "webspeech" && options.provider !== "demo",
        sent: [],
        connect: async () => handlers.status?.("listening"),
        sendAudio(chunk) {
          this.sent.push(chunk);
        },
        disconnect: async () => {},
        onPartial: (cb) => (handlers.partial = cb),
        onStable: (cb) => (handlers.stable = cb),
        onStatus: (cb) => (handlers.status = cb),
        onError: () => {},
        emitPartial: (text) => handlers.partial?.(text),
        emitStable: (text) => handlers.stable?.(text),
      };
      providers.push(provider);
      return provider;
    }),
  };
});

vi.mock("@/lib/session-client", () => ({
  guardedFetch: vi.fn(async () => new Response(JSON.stringify({ error: "offline" }), { status: 503 })),
}));

import {
  REMOTE_MIC_NEEDS_RAW_STT,
  REMOTE_MIC_NOT_CONNECTED,
  useLiveSession,
  type LiveSessionOptions,
} from "./useLiveSession";

const base: LiveSessionOptions = {
  context: "worship",
  sourceLanguage: "ko-KR",
  targetLanguage: "en-US",
  lag: "fast",
  source: "deepgram",
  audioSource: "remote",
  resolveScripture: false,
};

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  captures.length = 0;
  providers.length = 0;
  getUserMedia = vi.fn(async () => {
    throw new Error("the MacBook microphone must never be opened in remote mode");
  });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("remote microphone in the live session", () => {
  it("feeds the phone's stream into the existing MicrophoneCapture and on to STT and the engine", async () => {
    const remoteStream = new FakeStream([new FakeTrack("remote")]) as unknown as MediaStream;
    const { result } = renderHook(() => useLiveSession({ ...base, remoteStream: () => remoteStream }));

    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.phase).toBe("running"));

    expect(captures).toHaveLength(1);
    expect(captures[0].options.stream).toBe(remoteStream);
    expect(captures[0].options.deviceId).toBeUndefined();
    expect(captures[0].started).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.inputLabel).toMatch(/Remote microphone/);

    // A captured 16 kHz PCM16 frame goes to the recogniser untouched.
    const frame = new ArrayBuffer(1600);
    (captures[0].options.onFrame as (frame: ArrayBuffer) => void)(frame);
    expect(providers[0].sent).toEqual([frame]);

    // The recogniser's partial and stable text reach the existing engine.
    act(() => providers[0].emitPartial("안녕하세요 지금"));
    await waitFor(() => expect(result.current.snapshot.partial?.text ?? "").toContain("안녕하세요"));
    act(() => providers[0].emitStable("안녕하세요. 지금 아이폰 마이크를 이용해서 실시간 한국어 받아쓰기 기능을 테스트하고 있습니다."));
    await waitFor(() =>
      expect(result.current.snapshot.segments.map((s) => s.text).join(" ")).toContain("받아쓰기"),
    );

    await act(async () => {
      await result.current.stop();
    });
    expect(captures[0].stopped).toBe(true);
  });

  it("refuses to start when the phone is not connected — no local-mic fallback, no billed socket", async () => {
    const { result } = renderHook(() => useLiveSession({ ...base, remoteStream: () => null }));
    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.fault?.message).toBe(REMOTE_MIC_NOT_CONNECTED));
    expect(result.current.phase).toBe("idle");
    expect(captures).toHaveLength(0);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("treats a stream whose track has ended as not connected", async () => {
    const track = new FakeTrack("remote");
    track.stop();
    const stream = new FakeStream([track]) as unknown as MediaStream;
    const { result } = renderHook(() => useLiveSession({ ...base, remoteStream: () => stream }));
    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.fault?.message).toBe(REMOTE_MIC_NOT_CONNECTED));
    expect(captures).toHaveLength(0);
  });

  it("refuses the browser recogniser for a remote stream instead of listening to the Mac", async () => {
    const remoteStream = new FakeStream([new FakeTrack("remote")]) as unknown as MediaStream;
    const { result } = renderHook(() =>
      useLiveSession({ ...base, source: "webspeech", remoteStream: () => remoteStream }),
    );
    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.fault?.message).toBe(REMOTE_MIC_NEEDS_RAW_STT));
    expect(result.current.fault?.kind).toBe("unsupported");
    expect(captures).toHaveLength(0);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("recovers onto the phone's NEW stream after it reconnects, keeping the transcript", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let current: MediaStream | null = new FakeStream([new FakeTrack("first")]) as unknown as MediaStream;
      const { result } = renderHook(() => useLiveSession({ ...base, remoteStream: () => current }));
      await act(async () => {
        await result.current.start();
      });
      await waitFor(() => expect(result.current.phase).toBe("running"));
      act(() => providers[0].emitStable("첫 번째 문장입니다."));

      // The phone drops: its track ends and no stream is available yet.
      current = null;
      act(() => (captures[0].options.onEnded as () => void)());
      await waitFor(() => expect(result.current.phase).toBe("recovering"));

      // It comes back with a fresh peer and a fresh stream.
      const second = new FakeStream([new FakeTrack("second")]) as unknown as MediaStream;
      current = second;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      await waitFor(() => expect(result.current.phase).toBe("running"));
      const reopened = captures.at(-1)!;
      expect(reopened.options.stream).toBe(second);
      expect(captures.filter((capture) => capture.started && !capture.stopped)).toHaveLength(1);
      expect(result.current.snapshot.segments.map((s) => s.text).join(" ")).toContain("첫 번째");
      expect(getUserMedia).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
