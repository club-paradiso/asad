import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIVE_SOURCE,
  DEFAULT_LIVE_TARGET,
  LANGUAGES,
  LIVE_SOURCE_LANGUAGES,
  LIVE_TARGET_LANGUAGES,
  findLanguage,
  isSpacedScript,
  languageDirection,
  languageName,
  liveLanguagePairProblem,
  normaliseLanguageTag,
  suggestLanguage,
  translatorPair,
} from "./languages";
import { COUNTER_LANGUAGES } from "@/counter/languages";
import { deepgramLanguage, webSpeechLanguage, whisperLanguage } from "@/providers/stt/language";
import {
  counterSpeechPlan,
  counterVoiceSupport,
  preferBrowserForScript,
  sttLanguageSupport,
} from "@/providers/stt/capability";

describe("language registry", () => {
  it("has one entry per canonical tag and resolves it case-insensitively", () => {
    const ids = LANGUAGES.map((language) => language.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const language of LANGUAGES) {
      expect(findLanguage(language.id)).toBe(language);
      expect(findLanguage(language.id.toLowerCase())).toBe(language);
      expect(normaliseLanguageTag(language.id)).toBe(language.id);
      expect(languageName(language.id)).toBe(language.en);
    }
  });

  it("is the single source the counter view is derived from", () => {
    expect(COUNTER_LANGUAGES.map((language) => language.code)).toEqual(
      LANGUAGES.filter((language) => language.capabilities.counter).map((l) => l.id),
    );
    for (const counter of COUNTER_LANGUAGES) {
      const registry = findLanguage(counter.code)!;
      expect(counter.endonym).toBe(registry.endonym);
      expect(counter.speechSupported).toBe(registry.stt.webspeech !== null);
      expect(!!counter.rtl).toBe(registry.direction === "rtl");
    }
  });

  it("knows direction and word spacing per script", () => {
    expect(languageDirection("ar-SA")).toBe("rtl");
    expect(languageDirection("ur-PK")).toBe("rtl");
    expect(languageDirection("ko-KR")).toBe("ltr");
    expect(isSpacedScript("ko-KR")).toBe(true);
    expect(isSpacedScript("zh-CN")).toBe(false);
    expect(isSpacedScript("th-TH")).toBe(false);
    expect(isSpacedScript("ja-JP")).toBe(false);
  });

  it("suggests from a browser list and falls back rather than guessing", () => {
    expect(suggestLanguage(["vi-VN", "en-US"])).toBe("vi-VN");
    expect(suggestLanguage(["vi"])).toBe("vi-VN");
    expect(suggestLanguage(["xx"])).toBe("en-US");
    expect(suggestLanguage(undefined)).toBe("en-US");
  });
});

describe("Chinese script variants", () => {
  const TRADITIONAL_TAGS = ["zh-TW", "zh-tw", "zh-Hant", "zh-Hant-TW", "zh-HK", "zh-MO"];
  const SIMPLIFIED_TAGS = ["zh-CN", "zh-cn", "zh-Hans", "zh-Hans-SG", "zh-SG", "cmn"];

  it("never resolves a Traditional tag to the Simplified entry, or the reverse", () => {
    for (const tag of TRADITIONAL_TAGS) expect(normaliseLanguageTag(tag)).toBe("zh-TW");
    for (const tag of SIMPLIFIED_TAGS) expect(normaliseLanguageTag(tag)).toBe("zh-CN");
  });

  it("keeps the variant through every recogniser that can express it", () => {
    expect(deepgramLanguage("zh-TW")).toBe("zh-TW");
    expect(deepgramLanguage("zh-CN")).toBe("zh-CN");
    expect(webSpeechLanguage("zh-TW")).toBe("zh-TW");
    expect(webSpeechLanguage("zh-CN")).toBe("zh-CN");
    expect(translatorPair("ko-KR", "zh-TW")).toEqual({ source: "ko", target: "zh-Hant" });
    expect(translatorPair("ko-KR", "zh-CN")).toEqual({ source: "ko", target: "zh-Hans" });
  });

  it("says out loud that Whisper cannot express it", () => {
    // The root cause, stated once: the API selects a language, not a script.
    expect(whisperLanguage("zh-TW")).toEqual({ code: "zh", fidelity: "variant-lossy" });
    expect(whisperLanguage("zh-CN")).toEqual({ code: "zh", fidelity: "native" });
    expect(sttLanguageSupport("openai", "zh-TW")).toBe("variant-lossy");
    expect(sttLanguageSupport("openai", "zh-CN")).toBe("native");
  });

  it("ranks a script-losing path behind one that preserves the script", () => {
    const plan = counterSpeechPlan("zh-TW").map((entry) => entry.provider);
    expect(plan.indexOf("webspeech")).toBeLessThan(plan.indexOf("openai"));
    // Deepgram still leads: it has a real zh-TW model.
    expect(plan[0]).toBe("deepgram");
    expect(counterVoiceSupport("zh-TW")).toBe("native");

    // Simplified is unaffected — ordinary cloud-first preference.
    const simplified = counterSpeechPlan("zh-CN").map((entry) => entry.provider);
    expect(simplified).toEqual(["deepgram", "openai", "webspeech", "hf"]);
  });

  it("routes around an OpenAI-only deployment for Traditional Chinese only", () => {
    expect(
      preferBrowserForScript({ language: "zh-TW", cloud: "openai", browserAvailable: true }),
    ).toBe(true);
    expect(
      preferBrowserForScript({ language: "zh-TW", cloud: "deepgram", browserAvailable: true }),
    ).toBe(false);
    expect(
      preferBrowserForScript({ language: "zh-CN", cloud: "openai", browserAvailable: true }),
    ).toBe(false);
    expect(
      preferBrowserForScript({ language: "ko-KR", cloud: "openai", browserAvailable: true }),
    ).toBe(false);
    // With no browser recogniser there is nothing better to route to.
    expect(
      preferBrowserForScript({ language: "zh-TW", cloud: "openai", browserAvailable: false }),
    ).toBe(false);
  });
});

describe("live language pairs", () => {
  it("starts on Korean → English", () => {
    expect(liveLanguagePairProblem(DEFAULT_LIVE_SOURCE, DEFAULT_LIVE_TARGET)).toBeNull();
  });

  it("accepts every advertised source paired with every advertised target", () => {
    for (const source of LIVE_SOURCE_LANGUAGES) {
      for (const target of LIVE_TARGET_LANGUAGES) {
        const problem = liveLanguagePairProblem(source.id, target.id);
        if (source.base === target.base) expect(problem).toBe("same-language");
        else expect(problem, `${source.id}→${target.id}`).toBeNull();
      }
    }
  });

  it("refuses a pair before the session rather than during it", () => {
    expect(liveLanguagePairProblem("xx-XX", "en-US")).toBe("unknown-source");
    expect(liveLanguagePairProblem("ko-KR", "xx-XX")).toBe("unknown-target");
    expect(liveLanguagePairProblem("ko-KR", "ko-KR")).toBe("same-language");
    expect(liveLanguagePairProblem("zh-CN", "zh-TW")).toBe("same-language");
    // Uyghur has no recogniser anywhere, so it may be a target but never a
    // spoken source — offering the microphone would be a lie.
    expect(liveLanguagePairProblem("ug-CN", "ko-KR")).toBe("unknown-source");
    expect(liveLanguagePairProblem("ko-KR", "ug-CN")).toBeNull();
  });

  it("only offers the on-device fast lane for a pair Chrome can express", () => {
    expect(translatorPair("ko-KR", "en-US")).toEqual({ source: "ko", target: "en" });
    expect(translatorPair("ko-KR", "ug-CN")).toBeNull();
    expect(translatorPair("uz-UZ", "en-US")).toBeNull();
  });
});
