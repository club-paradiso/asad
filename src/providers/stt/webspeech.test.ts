import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSpeechProvider } from "./webspeech";

interface FakeSpeechResult {
  isFinal: boolean;
  0: { transcript: string };
  length: number;
}

interface FakeSpeechEvent {
  resultIndex: number;
  results: { length: number; [index: number]: FakeSpeechResult };
}

class FakeRecognition {
  static last: FakeRecognition | null = null;

  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  onresult: ((event: FakeSpeechEvent) => void) | null = null;
  onerror: ((event: { error?: string; message?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;

  constructor() {
    FakeRecognition.last = this;
  }
}

const result = (text: string, isFinal: boolean): FakeSpeechResult => ({
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

  /**
   * The reported defect: one recognition error ended the whole session.
   *
   * `audio-capture` and `service-not-allowed` were classified fatal, so a
   * headset switching or the platform speech service hiccupping once tore the
   * session down mid-sermon with no retry.
   */
  describe("recovering from a transient recogniser failure", () => {
    it("keeps listening after a single audio-capture blip", async () => {
      vi.useFakeTimers();
      const provider = new WebSpeechProvider();
      const statuses: string[] = [];
      const errors: string[] = [];
      provider.onStatus((status) => statuses.push(status));
      provider.onError((error) => errors.push(error.message));

      const connected = provider.connect();
      const recognition = FakeRecognition.last!;
      recognition.onstart?.();
      await connected;

      recognition.onerror?.({ error: "audio-capture" });
      await vi.advanceTimersByTimeAsync(400);

      // It retried rather than giving up…
      expect(recognition.start).toHaveBeenCalledTimes(2);
      expect(statuses).not.toContain("error");
      // …and said nothing to an interpreter who is mid-sentence.
      expect(errors).toEqual([]);
    });

    it("gives up only once the retry budget is spent", async () => {
      vi.useFakeTimers();
      const provider = new WebSpeechProvider();
      const statuses: string[] = [];
      const errors: string[] = [];
      provider.onStatus((status) => statuses.push(status));
      provider.onError((error) => errors.push(error.message));

      const connected = provider.connect();
      const recognition = FakeRecognition.last!;
      recognition.onstart?.();
      await connected;

      // Four failures are forgiven; the fifth is real.
      for (const delay of [400, 1200, 3000, 6000]) {
        recognition.onerror?.({ error: "audio-capture" });
        await vi.advanceTimersByTimeAsync(delay);
      }
      expect(statuses).not.toContain("error");

      recognition.onerror?.({ error: "audio-capture" });
      expect(statuses).toContain("error");
      expect(errors[0]).toMatch(/after 4 attempts/);
    });

    it("forgives afresh once listening resumes", async () => {
      vi.useFakeTimers();
      const provider = new WebSpeechProvider();
      const statuses: string[] = [];
      provider.onStatus((status) => statuses.push(status));

      const connected = provider.connect();
      const recognition = FakeRecognition.last!;
      recognition.onstart?.();
      await connected;

      // A blip an hour into the service must not be judged against failures
      // that already healed — otherwise a long session dies of old news.
      for (let i = 0; i < 8; i += 1) {
        recognition.onerror?.({ error: "service-not-allowed" });
        await vi.advanceTimersByTimeAsync(400);
        recognition.onstart?.();
      }

      expect(statuses).not.toContain("error");
    });

    it("still refuses to retry a denied microphone", async () => {
      vi.useFakeTimers();
      const provider = new WebSpeechProvider();
      const statuses: string[] = [];
      provider.onStatus((status) => statuses.push(status));

      const connected = provider.connect();
      const recognition = FakeRecognition.last!;
      recognition.onerror?.({ error: "not-allowed" });

      await expect(connected).rejects.toThrow("not-allowed");
      await vi.advanceTimersByTimeAsync(10_000);

      // Permission is a decision, not a blip: no retry, ever.
      expect(recognition.start).toHaveBeenCalledTimes(1);
      expect(statuses).toContain("error");
    });
  });
});
