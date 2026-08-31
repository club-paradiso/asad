import { describe, expect, it } from "vitest";
import { deepgramLanguage, webSpeechLanguage } from "./language";

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
  });

  it("maps Tagalog to the browser speech locale commonly exposed as Filipino", () => {
    expect(webSpeechLanguage("tl-PH")).toBe("fil-PH");
    expect(webSpeechLanguage("zh-TW")).toBe("zh-TW");
    expect(webSpeechLanguage("vi-VN")).toBe("vi-VN");
  });
});
