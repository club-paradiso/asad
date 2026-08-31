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
  it("starts from one call and resolves when the utterance ends naturally", async () => {
    const { result } = renderHook(() => useVoiceInput("ko-KR"));

    expect(result.current.supported).toBe(true);

    let spoken!: Promise<string>;
    await act(async () => {
      spoken = result.current.start();
    });

    await waitFor(() => expect(MockRecognition.current).not.toBeNull());

    expect(result.current.listening).toBe(true);
    expect(MockRecognition.current?.lang).toBe("ko-KR");
    // Counter keeps the recogniser open through short conversational pauses;
    // the controller, not the browser's first pause, decides turn completion.
    expect(MockRecognition.current?.continuous).toBe(true);
    expect(MockRecognition.current?.maxAlternatives).toBe(3);

    await act(async () => {
      MockRecognition.current?.emit("안녕하세요", true);
      MockRecognition.current?.end();
    });

    await expect(spoken).resolves.toBe("안녕하세요");
    expect(result.current.listening).toBe(false);
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
});
