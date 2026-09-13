import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSpeechProvider } from "./webspeech";

interface Alt { transcript: string; confidence?: number }
interface ResultLike { isFinal: boolean; length: number; [index: number]: Alt }
interface EventLike { resultIndex: number; results: { length: number; [index: number]: ResultLike } }

class Recognition {
  static last: Recognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  onresult: ((event: EventLike) => void) | null = null;
  onerror: ((event: { error?: string; message?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  constructor() { Recognition.last = this; }
}

const result = (alternatives: Array<string | Alt>, isFinal = true): ResultLike => {
  const value = { isFinal, length: alternatives.length } as ResultLike;
  alternatives.forEach((alternative, index) => {
    value[index] = typeof alternative === "string" ? { transcript: alternative } : alternative;
  });
  return value;
};

describe("WebSpeech multilingual behavior", () => {
  beforeEach(() => {
    Recognition.last = null;
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      writable: true,
      value: Recognition,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it("uses Chinese locale and selects the native-script alternative", async () => {
    const provider = new WebSpeechProvider({ language: "zh-CN", utterance: true });
    const stable: string[] = [];
    provider.onStable((text) => stable.push(text));

    const connected = provider.connect();
    const recognition = Recognition.last!;
    recognition.onstart?.();
    await connected;

    expect(recognition.lang).toBe("zh-CN");
    expect(recognition.maxAlternatives).toBe(3);
    recognition.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: result(["wo yao yan chang qian zheng", "我要延长签证"]) },
    });
    expect(stable).toEqual(["我要延长签证"]);
  });

  it("uses browser confidence to choose a better Mandarin hypothesis", async () => {
    const provider = new WebSpeechProvider({ language: "zh-CN", utterance: true });
    const stable: string[] = [];
    provider.onStable((text) => stable.push(text));

    const connected = provider.connect();
    const recognition = Recognition.last!;
    recognition.onstart?.();
    await connected;

    recognition.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: result([
          { transcript: "我要严常居留期间", confidence: 0.22 },
          { transcript: "我要延长居留期间", confidence: 0.91 },
        ]),
      },
    });
    expect(stable).toEqual(["我要延长居留期间"]);
  });

  describe("Traditional Chinese", () => {
    it("sets the zh-TW locale and prefers the Traditional alternative when confidence ties", async () => {
      const provider = new WebSpeechProvider({ language: "zh-TW", utterance: true });
      const stable: string[] = [];
      provider.onStable((text) => stable.push(text));

      const connected = provider.connect();
      const recognition = Recognition.last!;
      recognition.onstart?.();
      await connected;

      expect(recognition.lang).toBe("zh-TW");
      // The browser ranks the Simplified rendering first with the same score.
      // Before the registry owned the script, a Traditional speaker was handed
      // Simplified text here and nothing downstream could tell.
      recognition.onresult?.({
        resultIndex: 0,
        results: {
          length: 1,
          0: result([
            { transcript: "我要办签证", confidence: 0.8 },
            { transcript: "我要辦簽證", confidence: 0.8 },
          ]),
        },
      });
      expect(stable).toEqual(["我要辦簽證"]);
    });

    it("accepts a Hong Kong browser tag as Traditional and a Singapore one as Simplified", async () => {
      const traditional = new WebSpeechProvider({ language: "zh-Hant-HK", utterance: true });
      const connectedTraditional = traditional.connect();
      Recognition.last!.onstart?.();
      await connectedTraditional;
      expect(Recognition.last!.lang).toBe("zh-TW");

      const simplified = new WebSpeechProvider({ language: "zh-Hans-SG", utterance: true });
      const connectedSimplified = simplified.connect();
      Recognition.last!.onstart?.();
      await connectedSimplified;
      expect(Recognition.last!.lang).toBe("zh-CN");
    });

    it("keeps the Simplified choice for zh-CN when the same tie appears", async () => {
      const provider = new WebSpeechProvider({ language: "zh-CN", utterance: true });
      const stable: string[] = [];
      provider.onStable((text) => stable.push(text));

      const connected = provider.connect();
      const recognition = Recognition.last!;
      recognition.onstart?.();
      await connected;

      recognition.onresult?.({
        resultIndex: 0,
        results: {
          length: 1,
          0: result([
            { transcript: "我要辦簽證", confidence: 0.8 },
            { transcript: "我要办签证", confidence: 0.8 },
          ]),
        },
      });
      expect(stable).toEqual(["我要办签证"]);
    });
  });

  describe("stable-result metadata", () => {
    it("carries the chosen alternative's confidence and the other alternatives", async () => {
      const provider = new WebSpeechProvider({ language: "zh-TW", utterance: true });
      const stable: Array<{ text: string; meta?: { confidence?: number; alternatives?: string[] } }> = [];
      provider.onStable((text, meta) => stable.push({ text, meta }));

      const connected = provider.connect();
      const recognition = Recognition.last!;
      recognition.onstart?.();
      await connected;

      recognition.onresult?.({
        resultIndex: 0,
        results: {
          length: 1,
          0: result([
            { transcript: "我要办签证", confidence: 0.74 },
            { transcript: "我要辦簽證", confidence: 0.81 },
            { transcript: "我要辦簽正", confidence: 0.35 },
          ]),
        },
      });

      expect(stable).toEqual([
        {
          text: "我要辦簽證",
          meta: { confidence: 0.81, alternatives: ["我要办签证", "我要辦簽正"] },
        },
      ]);
    });

    it("omits confidence the browser did not report and stays one-argument compatible", async () => {
      const provider = new WebSpeechProvider({ language: "ko-KR", utterance: true });
      const calls: unknown[][] = [];
      provider.onStable((...args) => calls.push(args));

      const connected = provider.connect();
      const recognition = Recognition.last!;
      recognition.onstart?.();
      await connected;

      recognition.onresult?.({
        resultIndex: 0,
        results: { length: 1, 0: result(["여권을 보여 주세요"]) },
      });
      // Nothing to add: a single alternative with no confidence gets no meta at all.
      expect(calls).toEqual([["여권을 보여 주세요"]]);

      recognition.onresult?.({
        resultIndex: 1,
        results: {
          length: 2,
          0: result(["여권을 보여 주세요"]),
          1: result(["체류기간 연장", "체류 기간 연장"]),
        },
      });
      expect(calls[1]).toEqual(["체류기간 연장", { alternatives: ["체류 기간 연장"] }]);
    });
  });

  it("refuses at connect a language the registry keeps away from the browser recogniser", async () => {
    const provider = new WebSpeechProvider({ language: "ug-CN", utterance: true });
    await expect(provider.connect()).rejects.toThrow(
      "Browser speech recognition cannot transcribe Uyghur.",
    );
    // No recogniser was even constructed: the refusal is ours, not the browser's.
    expect(Recognition.last).toBeNull();
  });

  it("restarts an utterance recognizer when the browser auto-ends after speech began", async () => {
    vi.useFakeTimers();
    const provider = new WebSpeechProvider({ language: "zh-CN", utterance: true });
    const connected = provider.connect();
    const recognition = Recognition.last!;
    recognition.onstart?.();
    await connected;

    recognition.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: result(["我要延长"], false) },
    });
    recognition.onend?.();
    expect(recognition.start).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(180);
    expect(recognition.start).toHaveBeenCalledTimes(2);
  });

  it("does not restart forever when an utterance recognizer heard nothing", async () => {
    vi.useFakeTimers();
    const provider = new WebSpeechProvider({ language: "zh-CN", utterance: true });
    const statuses: string[] = [];
    provider.onStatus((status) => statuses.push(status));
    const connected = provider.connect();
    const recognition = Recognition.last!;
    recognition.onstart?.();
    await connected;

    recognition.onend?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(statuses).toContain("closed");
  });
});
