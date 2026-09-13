import { describe, expect, it } from "vitest";
import {
  deepgramLanguage,
  openaiTranscriptionLanguage,
  webSpeechLanguage,
  whisperScriptPrompt,
} from "./language";

describe("STT provider language mapping", () => {
  it("preserves Deepgram locale distinctions that affect recognition", () => {
    expect(deepgramLanguage("zh-CN")).toBe("zh-CN");
    expect(deepgramLanguage("zh-TW")).toBe("zh-TW");
    expect(deepgramLanguage("ko-KR")).toBe("ko-KR");
    expect(deepgramLanguage("th-TH")).toBe("th-TH");
    expect(deepgramLanguage("pt-BR")).toBe("pt-BR");
    expect(deepgramLanguage("ar-SA")).toBe("ar-SA");
  });

  it("uses the documented Deepgram base code where region is not a model distinction", () => {
    expect(deepgramLanguage("ja-JP")).toBe("ja");
    expect(deepgramLanguage("vi-VN")).toBe("vi");
    expect(deepgramLanguage("id-ID")).toBe("id");
    expect(deepgramLanguage("bn-BD")).toBe("bn");
    expect(deepgramLanguage("ur-PK")).toBe("ur");
  });

  it("recognises recently supported Nova-3 counter languages", () => {
    expect(deepgramLanguage("mn-MN")).toBe("mn");
    expect(deepgramLanguage("ne-NP")).toBe("ne");
    expect(deepgramLanguage("tl-PH")).toBe("tl");
  });

  it("fails fast for Counter languages not supported by Deepgram", () => {
    expect(deepgramLanguage("uz-UZ")).toBeNull();
    expect(deepgramLanguage("km-KH")).toBeNull();
    expect(deepgramLanguage("my-MM")).toBeNull();
    expect(deepgramLanguage("xx-XX")).toBeNull();
  });

  it("maps Tagalog to the browser speech locale commonly exposed as Filipino", () => {
    expect(webSpeechLanguage("tl-PH")).toBe("fil-PH");
    expect(webSpeechLanguage("zh-TW")).toBe("zh-TW");
    expect(webSpeechLanguage("vi-VN")).toBe("vi-VN");
  });

  it("resolves browser spellings through the registry instead of passing them through", () => {
    expect(webSpeechLanguage("zh-Hant-HK")).toBe("zh-TW");
    expect(webSpeechLanguage("zh")).toBe("zh-CN");
    expect(deepgramLanguage("cmn-Hant-TW")).toBe("zh-TW");
    expect(webSpeechLanguage("ug-CN")).toBeNull();
    expect(webSpeechLanguage("xx-XX")).toBeNull();
  });

  it("defaults to Korean when no language is given, on every provider", () => {
    expect(deepgramLanguage(undefined)).toBe("ko-KR");
    expect(webSpeechLanguage(undefined)).toBe("ko-KR");
    expect(openaiTranscriptionLanguage(undefined)).toBe("ko");
    expect(whisperScriptPrompt(undefined)).toBeUndefined();
  });

  it("gives Whisper a base code and, for Chinese, a script prompt", () => {
    expect(openaiTranscriptionLanguage("zh-TW")).toBe("zh");
    expect(openaiTranscriptionLanguage("zh-CN")).toBe("zh");
    expect(openaiTranscriptionLanguage("pt-BR")).toBe("pt");
    expect(openaiTranscriptionLanguage("ug-CN")).toBeNull();
    expect(whisperScriptPrompt("zh-TW")).toBe("以下是國語的繁體中文轉寫。");
    expect(whisperScriptPrompt("zh-CN")).toBe("以下是普通话的简体中文转写。");
    expect(whisperScriptPrompt("ja-JP")).toBeUndefined();
  });
});
