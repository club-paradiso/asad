import { describe, expect, it, vi } from "vitest";
import type { CreateSttOptions, SpeechProvider, SttStatus } from "@/providers/stt";
import {
  CounterSpeechController,
  type CounterSpeechDependencies,
  type CounterVoicePhase,
} from "./counter-speech";
import { __resetVoiceAttempts, voiceAttempts } from "./voice-diagnostics";

class FakeProvider implements SpeechProvider {
  readonly needsAudio: boolean;
  readonly id;
  disconnected = false;
  private partial: (text: string) => void = () => {};
  private stable: (text: string) => void = () => {};
  private status: (status: SttStatus, detail?: string) => void = () => {};

  constructor(options: CreateSttOptions) {
    this.id = options.provider;
    this.needsAudio = options.provider === "deepgram" || options.provider === "openai";
  }
  async connect() {
    this.status("listening");
  }
  sendAudio() {}
  async disconnect() {
    this.disconnected = true;
    this.status("closed");
  }
  onPartial(callback: (text: string) => void) {
    this.partial = callback;
  }
  onStable(callback: (text: string) => void) {
    this.stable = callback;
  }
  onStatus(callback: (status: SttStatus, detail?: string) => void) {
    this.status = callback;
  }
  onError() {}
  emitStable(text: string) {
    this.stable(text);
  }
  emitPartial(text: string) {
    this.partial(text);
  }
}

function harness(options: {
  language: string;
  credentialProvider?: "deepgram" | "openai" | "demo";
  profileId?: "immigration" | "general";
  hf?: boolean;
  browser?: boolean;
}) {
  const providers: FakeProvider[] = [];
  const createOptions: CreateSttOptions[] = [];
  const phases: CounterVoicePhase[] = [];
  const fetchCredentials = vi.fn(async () =>
    options.credentialProvider === "demo" || !options.credentialProvider
      ? { provider: "demo" as const }
      : { provider: options.credentialProvider, token: "temporary-token" },
  );
  const transcribeHf = vi.fn(async () => "batch transcript");

  const dependencies: CounterSpeechDependencies = {
    fetchCredentials,
    createProvider: (providerOptions) => {
      createOptions.push(providerOptions);
      const provider = new FakeProvider(providerOptions);
      providers.push(provider);
      return provider;
    },
    createMicrophone: ({ onFrame }) => ({
      async start() {
        // Loud enough to count as speech, so the batch path does not treat a
        // deliberate stop as "nothing was said".
        const frame = new ArrayBuffer(4);
        new DataView(frame).setInt16(0, 1000, true);
        onFrame(frame);
      },
      async stop() {},
    }),
    browserSpeechSupported: () => options.browser ?? true,
    cloudAudioSupported: () => true,
    hfFallbackSupported: () => options.hf ?? true,
    transcribeHf,
    connectTimeoutMs: 50,
    stableDelayMs: 0,
  };

  const controller = new CounterSpeechController(
    options.language,
    { onPhase: (phase) => phases.push(phase), onPartial: () => {} },
    dependencies,
    "ABC123",
    "token",
    { profileId: options.profileId },
  );
  return { controller, providers, createOptions, phases, fetchCredentials, transcribeHf };
}

describe("Counter speech provider selection", () => {
  it("does not open a socket for a language the vendor cannot transcribe", async () => {
    // Uzbek is not in Deepgram's tag table. Opening the socket anyway spent a
    // full connection deadline discovering that, once per turn, for exactly
    // the visitors least able to afford the wait.
    const run = harness({ language: "uz-UZ", credentialProvider: "deepgram" });
    const result = run.controller.listen();
    await vi.waitFor(() => expect(run.phases).toContain("listening"));
    run.controller.stop();
    await expect(result).resolves.toMatchObject({ text: "batch transcript" });
    expect(run.providers.map((provider) => provider.id)).not.toContain("deepgram");
  });

  it("skips the credential request when no cloud vendor covers the language", async () => {
    const run = harness({ language: "ug-CN" });
    await expect(run.controller.listen()).resolves.toMatchObject({
      failure: "unsupported-language",
    });
    expect(run.fetchCredentials).not.toHaveBeenCalled();
    expect(run.providers).toHaveLength(0);
    expect(run.phases.at(-1)).toBe("unavailable");
  });

  it("never uploads audio for a language nothing can transcribe", async () => {
    const run = harness({ language: "ug-CN", hf: true });
    await run.controller.listen();
    expect(run.transcribeHf).not.toHaveBeenCalled();
  });

  it("still uses the streaming vendor when it does cover the language", async () => {
    const run = harness({ language: "ko-KR", credentialProvider: "deepgram" });
    const result = run.controller.listen();
    await vi.waitFor(() => expect(run.providers).toHaveLength(1));
    expect(run.providers[0].id).toBe("deepgram");
    run.providers[0].emitStable("여권을 보여 주세요");
    await expect(result).resolves.toMatchObject({ text: "여권을 보여 주세요" });
  });
});

describe("Counter speech vocabulary hints", () => {
  it("sends immigration keyterms to the recogniser", async () => {
    const run = harness({
      language: "ko-KR",
      credentialProvider: "deepgram",
      profileId: "immigration",
    });
    const result = run.controller.listen();
    await vi.waitFor(() => expect(run.createOptions).toHaveLength(1));
    const hints = run.createOptions[0]?.hints ?? [];
    expect(hints).toContain("체류자격");
    expect(hints).toContain("하이코리아");
    expect(hints).toContain("E-7");
    run.providers[0].emitStable("네");
    await result;
  });

  it("sends nothing at a desk with no specialist vocabulary", async () => {
    const run = harness({
      language: "ko-KR",
      credentialProvider: "deepgram",
      profileId: "general",
    });
    const result = run.controller.listen();
    await vi.waitFor(() => expect(run.createOptions).toHaveLength(1));
    expect(run.createOptions[0]?.hints).toBeUndefined();
    run.providers[0].emitStable("네");
    await result;
  });
});

describe("Counter speech diagnostics", () => {
  it("records the shape of an attempt without recording what was said", () => {
    __resetVoiceAttempts();
    return (async () => {
      const run = harness({ language: "ko-KR", credentialProvider: "deepgram" });
      const result = run.controller.listen();
      await vi.waitFor(() => expect(run.providers).toHaveLength(1));
      run.providers[0].emitPartial("여권");
      run.providers[0].emitStable("여권을 보여 주세요");
      await result;

      const record = voiceAttempts().at(-1);
      expect(record?.language).toBe("ko-KR");
      expect(record?.provider).toBe("deepgram");
      expect(record?.support).toBe("native");
      expect(record?.marks.listening).toBeTypeOf("number");
      expect(record?.marks["first-partial"]).toBeTypeOf("number");

      // The privacy contract: every field is a category or a duration. No
      // transcript, no partial, no audio, no session code.
      const serialised = JSON.stringify(record);
      expect(serialised).not.toContain("여권");
      expect(serialised).not.toContain("ABC123");
      expect(serialised).not.toContain("token");
    })();
  });

  it("records why an attempt could not happen at all", async () => {
    __resetVoiceAttempts();
    const run = harness({ language: "ug-CN" });
    await run.controller.listen();
    expect(voiceAttempts().at(-1)?.failure).toBe("unsupported-language");
  });
});
