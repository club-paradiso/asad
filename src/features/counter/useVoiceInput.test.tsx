import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useVoiceInput } from "./useVoiceInput";

interface ResultEvent {
  resultIndex: number;
  results: {
    length: number;
    0: {
      isFinal: boolean;
      length: number;
      0: { transcript: string };
    };
  };
}

class MockRecognition {
  static current: MockRecognition | null = null;

  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: ResultEvent) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;

  constructor() {
    MockRecognition.current = this;
  }

  start() {
    this.onstart?.();
  }

  stop() {
    this.onend?.();
  }

  abort() {
    this.onend?.();
  }

  emit(text: string, isFinal: boolean) {
    this.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: {
          isFinal,
          length: 1,
          0: { transcript: text },
        },
      },
    });
  }

  fail(error = "language-not-supported") {
    this.onerror?.({ error });
  }

  end() {
    this.onend?.();
  }
}

beforeEach(() => {
  Object.assign(window, {
    SpeechRecognition: MockRecognition,
    webkitSpeechRecognition: undefined,
  });
});

afterEach(() => {
  MockRecognition.current = null;
  Reflect.deleteProperty(window, "SpeechRecognition");
  Reflect.deleteProperty(window, "webkitSpeechRecognition");
});

describe("useVoiceInput", () => {
  it("starts from one call and resolves when the controller decides the utterance ended", async () => {
    const { result } = renderHook(() => useVoiceInput("ko-KR"));

    expect(result.current.supported).toBe(true);

    let spoken!: Promise<string>;
    await act(async () => {
      spoken = result.current.start();
    });

    await waitFor(() => expect(MockRecognition.current).not.toBeNull());

    expect(result.current.listening).toBe(true);
    expect(MockRecognition.current?.lang).toBe("ko-KR");
    expect(MockRecognition.current?.continuous).toBe(true);
    expect(MockRecognition.current?.maxAlternatives).toBe(3);

    await act(async () => {
      MockRecognition.current?.emit("안녕하세요", true);
      // A browser auto-end no longer owns turn completion; the controller's
      // silence threshold does. This simulates WebKit ending early.
      MockRecognition.current?.end();
      await spoken;
    });

    await expect(spoken).resolves.toBe("안녕하세요");
    await waitFor(() => expect(result.current.listening).toBe(false));
  });

  it("keeps the latest interim words when a second tap stops listening", async () => {
    const { result } = renderHook(() => useVoiceInput("en-US"));

    let spoken!: Promise<string>;
    await act(async () => {
      spoken = result.current.start();
    });

    await waitFor(() => expect(MockRecognition.current).not.toBeNull());
    await act(async () => {
      MockRecognition.current?.emit("I need help with my visa", false);
    });

    expect(result.current.partial).toBe("I need help with my visa");

    await act(async () => {
      result.current.stop();
    });

    await expect(spoken).resolves.toBe("I need help with my visa");
    expect(result.current.listening).toBe(false);
  });

  it("recovers a useful partial transcript when speech recognition becomes unavailable", async () => {
    const { result } = renderHook(() => useVoiceInput("fr-FR"));

    let spoken!: Promise<string>;
    await act(async () => {
      spoken = result.current.start();
    });

    await waitFor(() => expect(MockRecognition.current).not.toBeNull());
    await act(async () => {
      MockRecognition.current?.emit("Je voudrais prolonger mon séjour", false);
      MockRecognition.current?.fail();
      await spoken;
    });

    await expect(spoken).resolves.toBe("Je voudrais prolonger mon séjour");
    await waitFor(() => expect(result.current.failure).not.toBeNull());
  });
});
