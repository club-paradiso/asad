import { describe, expect, it } from "vitest";
import {
  COUNTER_LANGUAGES,
  findLanguage,
  normaliseLanguageTag,
  suggestLanguage,
} from "./languages";
import { buildCounterPrompt } from "./prompt";
import {
  counterVoiceSupport,
  sttLanguageSupport,
} from "@/providers/stt/capability";
import { deepgramLanguage, webSpeechLanguage } from "@/providers/stt/language";

describe("Ukrainian counter language support", () => {
  it("keeps Ukrainian visible and resolves browser/base tags to uk-UA", () => {
    const ukrainian = findLanguage("uk-UA");

    expect(ukrainian).toMatchObject({
      code: "uk-UA",
      endonym: "Українська",
      ko: "우크라이나어",
      en: "Ukrainian",
      speechSupported: true,
    });
    expect(COUNTER_LANGUAGES.some((language) => language.code === "uk-UA")).toBe(true);
    expect(findLanguage("uk")).toEqual(ukrainian);
    expect(findLanguage("UK-ua")).toEqual(ukrainian);
    expect(normaliseLanguageTag("uk")).toBe("uk-UA");
    expect(suggestLanguage(["uk-UA", "en-US"])).toBe("uk-UA");
  });

  it("routes Ukrainian speech through supported recognisers", () => {
    expect(deepgramLanguage("uk-UA")).toBe("uk");
    expect(webSpeechLanguage("uk-UA")).toBe("uk-UA");
    expect(sttLanguageSupport("deepgram", "uk-UA")).toBe("native");
    expect(sttLanguageSupport("openai", "uk-UA")).toBe("native");
    expect(sttLanguageSupport("webspeech", "uk-UA")).toBe("native");
    expect(counterVoiceSupport("uk-UA")).toBe("native");
  });

  it("pins Ukrainian in model prompts instead of relying on auto-detection", () => {
    const inbound = buildCounterPrompt({
      text: "Добрий день. Я хочу продовжити термін перебування.",
      sourceLang: "uk-UA",
      targetLang: "ko-KR",
      inputMode: "voice",
      profileId: "immigration",
    });
    const outbound = buildCounterPrompt({
      text: "여권을 보여 주세요.",
      sourceLang: "ko-KR",
      targetLang: "uk-UA",
      inputMode: "text",
      profileId: "immigration",
    });

    expect(inbound).toContain("TRANSLATE FROM Ukrainian (uk-UA) INTO Korean (ko-KR).");
    expect(outbound).toContain("INTO Ukrainian (uk-UA)");
    expect(inbound).toContain("Do not auto-detect the language");
  });
});
