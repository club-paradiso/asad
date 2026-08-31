import { describe, expect, it, vi } from "vitest";
import type { CreateSttOptions, SpeechProvider, SttStatus } from "@/providers/stt";
import { CounterSpeechController, type CounterSpeechDependencies } from "./counter-speech";

class FakeProvider implements SpeechProvider {
  readonly id = "webspeech" as const;
  readonly needsAudio = false;
  private stable: (text: string) => void = () => {};
  private status: (status: SttStatus, detail?: string) => void = () => {};
  async connect() { this.status("listening"); }
  async disconnect() { this.status("closed"); }
  sendAudio() {}
  onPartial() {}
  onStable(callback: (text: string) => void) { this.stable = callback; }
  onStatus(callback: (status: SttStatus, detail?: string) => void) { this.status = callback; }
  onError() {}
  emitStable(text: string) { this.stable(text); }
}

describe("Counter language-aware utterance timing", () => {
  it("keeps Mandarin open through a normal short pause", async () => {
    vi.useFakeTimers();
    const provider = new FakeProvider();
    const dependencies: CounterSpeechDependencies = {
      fetchCredentials: vi.fn(async () => ({ provider: "demo" as const })),
      createProvider: (_options: CreateSttOptions) => provider,
      createMicrophone: () => ({ async start() {}, async stop() {} }),
      browserSpeechSupported: () => true,
      cloudAudioSupported: () => false,
      connectTimeoutMs: 100,
      stableDelayMs: 1400,
    };
    const controller = new CounterSpeechController(
      "zh-CN",
      { onPhase: () => {}, onPartial: () => {} },
      dependencies,
    );

    const result = controller.listen();
    await Promise.resolve();
    await Promise.resolve();
    provider.emitStable("我要延长");

    await vi.advanceTimersByTimeAsync(1500);
    let settled = false;
    void result.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    provider.emitStable("居留期间");
    await vi.advanceTimersByTimeAsync(1900);
    await expect(result).resolves.toEqual({ text: "我要延长居留期间", usedFallback: false });
    vi.useRealTimers();
  });
});
