import { describe, expect, it, vi } from "vitest";
import type { CreateSttOptions, SpeechProvider, SttStatus } from "@/providers/stt";
import {
  CounterSpeechController,
  type CounterSpeechDependencies,
  type CounterVoicePhase,
} from "./counter-speech";

class DelayedCloudProvider implements SpeechProvider {
  readonly id = "deepgram" as const;
  readonly needsAudio = true;
  sent: ArrayBuffer[] = [];
  private partial: (text: string) => void = () => {};
  private stable: (text: string) => void = () => {};
  private status: (status: SttStatus) => void = () => {};
  private error: (error: Error) => void = () => {};
  private releaseConnection: (() => void) | null = null;

  connect(): Promise<void> {
    return new Promise((resolve) => {
      this.releaseConnection = () => {
        this.status("listening");
        resolve();
      };
    });
  }

  release() {
    this.releaseConnection?.();
  }

  sendAudio(chunk: ArrayBuffer) {
    this.sent.push(chunk);
  }

  async disconnect() {
    this.status("closed");
  }

  onPartial(callback: (text: string) => void) { this.partial = callback; }
  onStable(callback: (text: string) => void) { this.stable = callback; }
  onStatus(callback: (status: SttStatus) => void) { this.status = callback; }
  onError(callback: (error: Error) => void) { this.error = callback; }

  emitStable(text: string) {
    this.stable(text);
  }
}

describe("Counter speech startup buffer", () => {
  it("captures audio immediately and flushes it when cloud STT becomes ready", async () => {
    const provider = new DelayedCloudProvider();
    const phases: CounterVoicePhase[] = [];
    let microphoneStarted = false;
    const firstFrame = new ArrayBuffer(8);
    new DataView(firstFrame).setInt16(0, 1234, true);

    const dependencies: CounterSpeechDependencies = {
      fetchCredentials: vi.fn(async () => ({
        provider: "deepgram" as const,
        token: "temporary-token",
      })),
      createProvider: (_options: CreateSttOptions) => provider,
      createMicrophone: ({ onFrame }) => ({
        async start() {
          microphoneStarted = true;
          onFrame(firstFrame);
        },
        async stop() {},
      }),
      browserSpeechSupported: () => false,
      cloudAudioSupported: () => true,
      hfFallbackSupported: () => false,
      transcribeHf: vi.fn(async () => ""),
      connectTimeoutMs: 1000,
      stableDelayMs: 0,
    };

    const controller = new CounterSpeechController(
      "ko-KR",
      {
        onPhase: (phase) => phases.push(phase),
        onPartial: () => {},
      },
      dependencies,
    );

    const result = controller.listen();
    await vi.waitFor(() => expect(microphoneStarted).toBe(true));

    // The human has already spoken, but the provider socket is not ready yet.
    // The frame must stay local instead of being discarded.
    expect(provider.sent).toHaveLength(0);
    expect(phases).not.toContain("listening");

    provider.release();
    await vi.waitFor(() => expect(provider.sent).toHaveLength(1));
    expect(new DataView(provider.sent[0]).getInt16(0, true)).toBe(1234);
    expect(phases).toContain("listening");

    provider.emitStable("안녕하세요");
    await expect(result).resolves.toEqual({ text: "안녕하세요", usedFallback: false });
  });
});
