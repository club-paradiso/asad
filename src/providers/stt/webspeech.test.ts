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

    await expect(connected).rejects.toThrow(/Microphone access was refused/);
    recognition.onend?.();
    await vi.advanceTimersByTimeAsync(1000);

    expect(recognition.start).toHaveBeenCalledTimes(1);
    // What the interpreter is told: what happened, and what to do about it.
    // The browser's own code for it is not part of that sentence.
    expect(errors).toEqual([
      "Microphone access was refused. Allow it in the browser's site settings, then tap Try again.",
    ]);
    expect(statuses).toContain("error");
  });

  it("never puts a recogniser error code in front of the interpreter", async () => {
    vi.useFakeTimers();
    const codes = [
      "not-allowed",
      "service-not-allowed",
      "language-not-supported",
      "audio-capture",
      "network",
      "something-nobody-has-seen",
    ];

    for (const code of codes) {
      const provider = new WebSpeechProvider();
      const errors: Error[] = [];
      provider.onError((error) => errors.push(error));

      const connected = provider.connect();
      const recognition = FakeRecognition.last!;
      recognition.onstart?.();
      await connected;

      // Spend the retry budget so even recoverable codes reach the interpreter.
      for (let i = 0; i < 5; i += 1) {
        recognition.onerror?.({ error: code });
        await vi.advanceTimersByTimeAsync(6000);
      }

      expect(errors.length).toBeGreaterThan(0);
      for (const error of errors) {
        expect(error.message).not.toContain(code);
        expect(error.message).toMatch(/[.!]$/);
        // The code is still available to whoever is debugging the deployment.
        expect((error as Error & { code?: string }).code).toBe(code);
      }
    }
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

  it("promotes an unchanged interim hypothesis when WebKit never marks it final", async () => {
    vi.useFakeTimers();
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
      resultIndex: 0,
      results: {
        length: 1,
        0: result("하나님은 사랑이십니다", false),
      },
    });

    expect(partials).toEqual(["하나님은 사랑이십니다"]);
    expect(stable).toEqual([]);

    await vi.advanceTimersByTimeAsync(1099);
    expect(stable).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(stable).toEqual(["하나님은 사랑이십니다"]);

    // If WebKit eventually reports the same hypothesis as final, do not feed
    // the sermon engine the same sentence twice.
    recognition.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: result("하나님은 사랑이십니다", true),
      },
    });
    expect(stable).toEqual(["하나님은 사랑이십니다"]);
  });

  /**
   * The reported defect: the same sentence reached the engine twice.
   *
   * WebKit promotes a hypothesis through the interim timer above and then
   * finalises it with different wording a second later. The delta was computed
   * with a plain `startsWith`, so any revision that was not a pure extension
   * returned the WHOLE sentence — which the engine had already interpreted,
   * rendered and very possibly committed.
   */
  it("emits only the revised tail when a promoted interim is finalised differently", async () => {
    vi.useFakeTimers();
    const provider = new WebSpeechProvider();
    const stable: string[] = [];
    provider.onStable((text) => stable.push(text));

    const connected = provider.connect();
    const recognition = FakeRecognition.last!;
    recognition.onstart?.();
    await connected;

    recognition.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: result("하나님은 사랑이십니다", false) },
    });
    await vi.advanceTimersByTimeAsync(1100);
    expect(stable).toEqual(["하나님은 사랑이십니다"]);

    recognition.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: result("하나님은 사랑이심을 믿습니다", true) },
    });

    // Not the whole sentence again — only the words the recogniser changed.
    expect(stable).toEqual(["하나님은 사랑이십니다", "사랑이심을 믿습니다"]);
  });

  /**
   * A recognition session's result list only grows. Re-ranking every settled
   * result on every event made the cost of one recogniser event proportional to
   * how long the service had been running — on the thread that renders the
   * English.
   */
  it("does not re-read results that settled before this event", async () => {
    const provider = new WebSpeechProvider({ language: "ko-KR" });
    const stable: string[] = [];
    provider.onStable((text) => stable.push(text));

    const connected = provider.connect();
    const recognition = FakeRecognition.last!;
    recognition.onstart?.();
    await connected;

    const settled = result("앞서 확정된 문장입니다", true);
    let reads = 0;
    Object.defineProperty(settled, "0", {
      get() {
        reads += 1;
        return { transcript: "앞서 확정된 문장입니다" };
      },
    });

    recognition.onresult?.({
      resultIndex: 1,
      results: { length: 2, 0: settled, 1: result("새로 들어온 말", true) },
    });

    expect(reads).toBe(0);
    expect(stable).toEqual(["새로 들어온 말"]);
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
      // The budget itself is the assertion: four restarts were attempted on top
      // of the original start, and the fifth failure was not forgiven.
      expect(recognition.start).toHaveBeenCalledTimes(5);
      expect(errors[0]).toMatch(/could not recover/);
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

    /**
     * An unrecognised code used to satisfy none of the branches: no error, no
     * restart, and a status stuck on "reconnecting" while nothing was
     * listening. Browsers do not agree on this vocabulary, so an unknown code
     * has to behave like every other transient failure.
     */
    it("retries an unfamiliar error code rather than going quietly dead", async () => {
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

      recognition.onerror?.({ error: "a-code-from-a-future-browser" });
      await vi.advanceTimersByTimeAsync(400);

      expect(recognition.start).toHaveBeenCalledTimes(2);
      expect(statuses).not.toContain("error");
      expect(errors).toEqual([]);

      for (const delay of [1200, 3000, 6000, 6000]) {
        recognition.onerror?.({ error: "a-code-from-a-future-browser" });
        await vi.advanceTimersByTimeAsync(delay);
      }

      // And once retrying has genuinely failed, it says so instead of pretending.
      expect(statuses).toContain("error");
      expect(errors[0]).toMatch(/could not recover/);
    });

    it("still refuses to retry a denied microphone", async () => {
      vi.useFakeTimers();
      const provider = new WebSpeechProvider();
      const statuses: string[] = [];
      provider.onStatus((status) => statuses.push(status));

      const connected = provider.connect();
      const recognition = FakeRecognition.last!;
      recognition.onerror?.({ error: "not-allowed" });

      await expect(connected).rejects.toThrow(/Microphone access was refused/);
      await vi.advanceTimersByTimeAsync(10_000);

      // Permission is a decision, not a blip: no retry, ever.
      expect(recognition.start).toHaveBeenCalledTimes(1);
      expect(statuses).toContain("error");
    });
  });
});
