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
