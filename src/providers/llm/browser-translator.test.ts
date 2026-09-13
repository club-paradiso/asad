import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginBrowserTranslatorPreparation,
  browserTranslatorSupportsPair,
  chunkTranslation,
  translateWithBrowserTranslator,
  type BrowserTranslatorSession,
} from "./browser-translator";

afterEach(() => {
  vi.unstubAllGlobals();
});

const KO_EN = { source: "ko-KR", target: "en-US" };

type CreateOptions = {
  sourceLanguage: string;
  targetLanguage: string;
  monitor?: (m: {
    addEventListener: (_type: "downloadprogress", listener: (event: { loaded: number }) => void) => void;
  }) => void;
};

describe("Chrome on-device Translator fallback", () => {
  it("fails softly when the browser does not expose Translator", async () => {
    vi.stubGlobal("Translator", undefined);
    const prepared = beginBrowserTranslatorPreparation({ pair: KO_EN });
    expect(prepared.supported).toBe(false);
    await expect(prepared.session).resolves.toBeNull();
  });

  it("starts ko-to-en creation immediately and reports download progress", async () => {
    const session: BrowserTranslatorSession = {
      translate: vi.fn(async () => "Hello."),
      destroy: vi.fn(),
    };
    let downloadListener: ((event: { loaded: number }) => void) | undefined;
    const create = vi.fn((options: CreateOptions) => {
      options.monitor?.({
        addEventListener: (_type, listener) => {
          downloadListener = listener;
        },
      });
      return Promise.resolve(session);
    });
    vi.stubGlobal("Translator", { create });
    const progress = vi.fn();

    const prepared = beginBrowserTranslatorPreparation({ pair: KO_EN, onDownloadProgress: progress });
    expect(prepared.supported).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toMatchObject({ sourceLanguage: "ko", targetLanguage: "en" });
    downloadListener?.({ loaded: 0.42 });
    expect(progress).toHaveBeenCalledWith(0.42);
    await expect(prepared.session).resolves.toBe(session);
  });

  it("asks Chrome for the Traditional-Chinese pack when the source is zh-TW", () => {
    const create = vi.fn((_options: CreateOptions) =>
      Promise.resolve({ translate: vi.fn(async () => ""), destroy: vi.fn() }),
    );
    vi.stubGlobal("Translator", { create });

    // Chrome keys Simplified as plain `zh` and Traditional as `zh-Hant`; the
    // registry knows that, so a Hong Kong browser tag must not become `zh`.
    beginBrowserTranslatorPreparation({ pair: { source: "zh-Hant-HK", target: "ko-KR" } });
    expect(create.mock.calls[0][0]).toMatchObject({ sourceLanguage: "zh-Hant", targetLanguage: "ko" });

    beginBrowserTranslatorPreparation({ pair: { source: "zh-CN", target: "en-US" } });
    expect(create.mock.calls[1][0]).toMatchObject({ sourceLanguage: "zh", targetLanguage: "en" });
  });

  it("reports a pair the browser cannot translate without touching the API", async () => {
    const create = vi.fn();
    vi.stubGlobal("Translator", { create });

    // A tag outside the registry has no Chrome key at all.
    const prepared = beginBrowserTranslatorPreparation({ pair: { source: "xx-XX", target: "ko-KR" } });
    expect(prepared.supported).toBe(false);
    await expect(prepared.session).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();

    expect(browserTranslatorSupportsPair({ source: "xx-XX", target: "ko-KR" })).toBe(false);
    expect(browserTranslatorSupportsPair({ source: "ko-KR", target: "xx-XX" })).toBe(false);
    expect(browserTranslatorSupportsPair(KO_EN)).toBe(true);
    expect(browserTranslatorSupportsPair({ source: "zh-TW", target: "ko-KR" })).toBe(true);
  });

  it("shapes an on-device translation as medium-confidence safe chunks", async () => {
    const translator: BrowserTranslatorSession = {
      translate: vi.fn(async () => "Hello. Today we are checking the interpreting system."),
      destroy: vi.fn(),
    };

    const output = await translateWithBrowserTranslator(
      translator,
      "안녕하세요. 오늘은 통역 시스템을 점검합니다.",
    );

    expect(output).toEqual({
      safeChunks: [
        { text: "Hello.", confidence: "medium" },
        { text: "Today we are checking the interpreting system.", confidence: "medium" },
      ],
      confidence: "medium",
    });
  });

  it("honours an aborted turn without emitting stale English", async () => {
    const translator: BrowserTranslatorSession = {
      translate: vi.fn(async () => "Too late."),
      destroy: vi.fn(),
    };
    const controller = new AbortController();
    controller.abort();

    await expect(
      translateWithBrowserTranslator(translator, "이미 지나간 발화", controller.signal),
    ).resolves.toBeNull();
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("keeps fallback chunks inside the InterpreterOutput bounds", () => {
    const long = Array.from({ length: 900 }, () => "word").join(" ");
    const chunks = chunkTranslation(long);
    expect(chunks.length).toBeLessThanOrEqual(8);
    expect(chunks.every((chunk) => chunk.length <= 380)).toBe(true);
  });
});
