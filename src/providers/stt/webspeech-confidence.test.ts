import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSpeechProvider } from "./webspeech";

interface Alternative { transcript: string; confidence?: number }
interface ResultLike { isFinal: boolean; length: number; [index: number]: Alternative }
interface EventLike { resultIndex: number; results: { length: number; [index: number]: ResultLike } }

class Recognition {
  static last: Recognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((event: EventLike) => void) | null = null;
  onerror: ((event: { error?: string; message?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  constructor() { Recognition.last = this; }
  start() {}
  stop() {}
  abort() {}
}

describe("Mandarin WebSpeech confidence", () => {
  beforeEach(() => {
    Recognition.last = null;
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      writable: true,
      value: Recognition,
    });
  });

  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it("prefers a high-confidence Mandarin hypothesis over a low-confidence same-script one", async () => {
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
        0: {
          isFinal: true,
          length: 2,
          0: { transcript: "我要严常居留期间", confidence: 0.22 },
          1: { transcript: "我要延长居留期间", confidence: 0.91 },
        },
      },
    });

    expect(stable).toEqual(["我要延长居留期间"]);
  });
});
