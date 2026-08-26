import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSpeechProvider } from "./webspeech";

class FakeRecognition {
  static last: FakeRecognition | null = null;

  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: { error?: string; message?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;

  constructor() {
    FakeRecognition.last = this;
  }
}

const result = (text: string, isFinal: boolean) => ({
  isFinal,
  0: { transcript: text },
  length: 1,
});

describe("WebSpeechProvider", () => {
  beforeEach(() => {
    FakeRecognition.last = null;
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      writable: true,
      value: FakeRecognition,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it("resolves only after the browser reports that it is listening", async () => {
    const provider = new WebSpeechProvider({ language: "ko-KR" });
    const statuses: string[] = [];
    provider.onStatus((status) => statuses.push(status));

    const connected = provider.connect();
    const recognition = FakeRecognition.last!;

    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(recognition.lang).toBe("ko-KR");
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(statuses).toEqual(["connecting"]);

    recognition.onstart?.();
    await connected;

    expect(statuses).toEqual(["connecting", "listening"]);
  });

  it("does not restart forever after microphone permission is denied", async () => {
    vi.useFakeTimers();
    const provider = new WebSpeechProvider();
    const statuses: string[] = [];
    const errors: string[] = [];
    provider.onStatus((status) => statuses.push(status));
    provider.onError((error) => errors.push(error.message));

    const connected = provider.connect();
    const recognition = FakeRecognition.last!;
    recognition.onerror?.({ error: "not-allowed" });

    await expect(connected).rejects.toThrow("not-allowed");
    recognition.onend?.();
    await vi.advanceTimersByTimeAsync(1000);

    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(errors).toEqual(["Speech recognition error: not-allowed"]);
    expect(statuses).toContain("error");
  });

  it("keeps unchanged interim words when a later result is updated", async () => {
    const provider = new WebSpeechProvider();
    const partials: string[] = [];
    const stable: string[] = [];
    provider.onPartial((text) => partials.push(text));
    provider.onStable((text) => stable.push(text));

    const connected = provider.connect();
    const recognition = FakeRecognition.last!;
    recognition.onstart?.();
    await connected;

    recognition.onresult?.({
      resultIndex: 2,
      results: {
        length: 3,
        0: result("이미 확정", true),
        1: result("안녕", false),
        2: result("하세요", false),
      },
    });

    expect(stable).toEqual([]);
    expect(partials).toEqual(["안녕하세요"]);
  });

  it("restarts after a normal browser end while the session is wanted", async () => {
    vi.useFakeTimers();
    const provider = new WebSpeechProvider();
    const connected = provider.connect();
    const recognition = FakeRecognition.last!;
    recognition.onstart?.();
    await connected;

    recognition.onend?.();
    expect(recognition.start).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(350);
    expect(recognition.start).toHaveBeenCalledTimes(2);
  });
});
