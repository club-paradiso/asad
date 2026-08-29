import { describe, expect, it, vi } from "vitest";
import type { CreateSttOptions, SpeechProvider, SttStatus } from "@/providers/stt";
import {
  CounterSpeechController,
  type CounterSpeechDependencies,
  type CounterVoicePhase,
} from "./counter-speech";

class FakeProvider implements SpeechProvider {
  readonly needsAudio: boolean;
  readonly id;
  disconnected = false;
  sentFrames = 0;
  private partial: (text: string) => void = () => {};
  private stable: (text: string) => void = () => {};
  private status: (status: SttStatus, detail?: string) => void = () => {};
  private error: (error: Error) => void = () => {};

  constructor(options: CreateSttOptions, private readonly connectFailure?: Error) {
    this.id = options.provider;
    this.needsAudio = options.provider === "deepgram" || options.provider === "openai";
  }
  async connect() {
    if (this.connectFailure) throw this.connectFailure;
    this.status("listening");
  }
  sendAudio() { this.sentFrames += 1; }
  async disconnect() { this.disconnected = true; this.status("closed"); }
  onPartial(callback: (text: string) => void) { this.partial = callback; }
  onStable(callback: (text: string) => void) { this.stable = callback; }
  onStatus(callback: (status: SttStatus, detail?: string) => void) { this.status = callback; }
  onError(callback: (error: Error) => void) { this.error = callback; }
  emitPartial(text: string) { this.partial(text); }
  emitStable(text: string) { this.stable(text); }
}

function harness(options?: {
  cloud?: boolean;
  browser?: boolean;
  cloudFailure?: Error;
  microphoneFailure?: Error;
}) {
  const providers: FakeProvider[] = [];
  const phases: CounterVoicePhase[] = [];
  let microphoneStops = 0;
  let fallbackCount = 0;
  const createOptions: CreateSttOptions[] = [];
  const dependencies: CounterSpeechDependencies = {
    fetchCredentials: vi.fn(async () =>
      options?.cloud
        ? { provider: "deepgram" as const, token: "temporary-token" }
        : { provider: "demo" as const },
    ),
    createProvider: (providerOptions) => {
      createOptions.push(providerOptions);
      const provider = new FakeProvider(
        providerOptions,
        providerOptions.provider === "deepgram" ? options?.cloudFailure : undefined,
      );
      providers.push(provider);
      return provider;
    },
    createMicrophone: ({ onFrame }) => ({
      async start() {
        if (options?.microphoneFailure) throw options.microphoneFailure;
        onFrame(new ArrayBuffer(4));
      },
      async stop() { microphoneStops += 1; },
    }),
    browserSpeechSupported: () => options?.browser ?? true,
    cloudAudioSupported: () => true,
    connectTimeoutMs: 50,
    stableDelayMs: 0,
  };
  const controller = new CounterSpeechController(
    "ko-KR",
    {
      onPhase: (phase) => phases.push(phase),
      onPartial: () => {},
      onFallback: () => { fallbackCount += 1; },
    },
    dependencies,
  );
  return {
    controller, providers, phases, createOptions, dependencies,
    get microphoneStops() { return microphoneStops; },
    get fallbackCount() { return fallbackCount; },
  };
}

const nextTask = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("CounterSpeechController", () => {
  it("uses configured cloud speech for one utterance and disposes microphone audio", async () => {
    const run = harness({ cloud: true, browser: true });
    const resultPromise = run.controller.listen();
    await nextTask();
    expect(run.providers[0]?.id).toBe("deepgram");
    expect(run.createOptions[0]?.utterance).toBe(true);
    run.providers[0].emitStable("9월 7일까지예요");
    await expect(resultPromise).resolves.toEqual({ text: "9월 7일까지예요", usedFallback: false });
    expect(run.providers[0].disconnected).toBe(true);
    expect(run.providers[0].sentFrames).toBe(1);
    expect(run.microphoneStops).toBeGreaterThan(0);
  });

  it("falls back from unavailable cloud speech to browser speech", async () => {
    const run = harness({ cloud: true, browser: true, cloudFailure: new Error("offline") });
    const resultPromise = run.controller.listen();
    await vi.waitFor(() => expect(run.providers.map((provider) => provider.id)).toEqual(["deepgram", "webspeech"]));
    run.providers[1].emitStable("여권을 보여 주세요");
    await expect(resultPromise).resolves.toEqual({ text: "여권을 보여 주세요", usedFallback: true });
    expect(run.fallbackCount).toBe(1);
  });

  it("keeps typing available when cloud and browser speech are unavailable", async () => {
    const run = harness({ cloud: false, browser: false });
    await expect(run.controller.listen()).resolves.toEqual({ text: "", failure: "unavailable", usedFallback: false });
    expect(run.providers).toHaveLength(0);
    expect(run.phases.at(-1)).toBe("unavailable");
  });

  it("does not repeat a denied microphone request through another provider", async () => {
    const run = harness({ cloud: true, browser: true, microphoneFailure: new DOMException("denied", "NotAllowedError") });
    await expect(run.controller.listen()).resolves.toEqual({ text: "", failure: "permission", usedFallback: false });
    expect(run.providers.map((provider) => provider.id)).toEqual(["deepgram"]);
  });

  it("keeps the latest partial transcript when stopped early", async () => {
    const run = harness({ cloud: false, browser: true });
    const resultPromise = run.controller.listen();
    await vi.waitFor(() => expect(run.phases).toContain("listening"));
    run.providers[0].emitPartial("I need help with my visa");
    run.controller.stop();
    await expect(resultPromise).resolves.toEqual({ text: "I need help with my visa", usedFallback: false });
    expect(run.phases).toContain("finishing");
  });

  it("reports no speech without disabling a later typed turn", async () => {
    const run = harness({ cloud: false, browser: true });
    const resultPromise = run.controller.listen();
    await nextTask();
    await run.providers[0].disconnect();
    await expect(resultPromise).resolves.toEqual({ text: "", failure: "no-speech", usedFallback: false });
  });

  it("prevents two recognisers racing after a rapid double tap", async () => {
    const run = harness({ cloud: false, browser: true });
    const first = run.controller.listen();
    await nextTask();
    await expect(run.controller.listen()).resolves.toEqual({ text: "", failure: "stopped", usedFallback: false });
    expect(run.providers).toHaveLength(1);
    run.controller.stop();
    await first;
  });

  it("aborts the active provider when its component unmounts", async () => {
    const run = harness({ cloud: false, browser: true });
    const resultPromise = run.controller.listen();
    await nextTask();
    run.controller.dispose();
    await expect(resultPromise).resolves.toMatchObject({ failure: "stopped" });
    expect(run.providers[0].disconnected).toBe(true);
  });

  it("passes the selected RTL language to speech", async () => {
    const run = harness({ cloud: false, browser: true });
    const controller = new CounterSpeechController("ar-SA", { onPhase: () => {}, onPartial: () => {} }, run.dependencies);
    const resultPromise = controller.listen();
    await nextTask();
    run.providers[0].emitStable("أحتاج إلى مساعدة");
    await resultPromise;
    expect(run.createOptions[0]?.language).toBe("ar-SA");
  });
});
