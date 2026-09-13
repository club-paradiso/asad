import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginBrowserTranslatorPreparation,
  chunkTranslation,
  translateWithBrowserTranslator,
  type BrowserTranslatorSession,
} from "./browser-translator";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Chrome on-device Translator fallback", () => {
  it("fails softly when the browser does not expose Translator", async () => {
    vi.stubGlobal("Translator", undefined);
    const prepared = beginBrowserTranslatorPreparation();
    expect(prepared.supported).toBe(false);
    await expect(prepared.session).resolves.toBeNull();
  });

  it("starts ko-to-en creation immediately and reports download progress", async () => {
    const session: BrowserTranslatorSession = {
      translate: vi.fn(async () => "Hello."),
      destroy: vi.fn(),
    };
    let downloadListener: ((event: { loaded: number }) => void) | undefined;
    const create = vi.fn((options: {
      sourceLanguage: string;
      targetLanguage: string;
      monitor?: (m: { addEventListener: (_type: "downloadprogress", listener: typeof downloadListener) => void }) => void;
    }) => {
      options.monitor?.({
        addEventListener: (_type, listener) => {
          downloadListener = listener;
        },
      });
      return Promise.resolve(session);
    });
    vi.stubGlobal("Translator", { create });
    const progress = vi.fn();

    const prepared = beginBrowserTranslatorPreparation({ onDownloadProgress: progress });
    expect(prepared.supported).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toMatchObject({ sourceLanguage: "ko", targetLanguage: "en" });
    downloadListener?.({ loaded: 0.42 });
    expect(progress).toHaveBeenCalledWith(0.42);
    await expect(prepared.session).resolves.toBe(session);
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
