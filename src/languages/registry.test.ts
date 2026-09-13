import { describe, expect, it } from "vitest";
import {
  LANGUAGES,
  LANGUAGE_IDS,
  browserTranslatorTagFor,
  canonicalLanguageId,
  canonicalPair,
  isKoreanToEnglish,
  isSpacelessLanguage,
  languageBase,
  languageDisplayName,
  languageScript,
  pairLabel,
  resolveLanguage,
  sttLanguageFor,
  suggestLanguageId,
  whisperPromptFor,
} from "./registry";

describe("language registry integrity", () => {
  it("gives every language a unique id and a unique base-default", () => {
    const ids = LANGUAGES.map((language) => language.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(LANGUAGE_IDS).toEqual(ids);
  });

  it("resolves every id to itself, case-insensitively and with underscores", () => {
    for (const language of LANGUAGES) {
      expect(resolveLanguage(language.id)?.id, language.id).toBe(language.id);
      expect(resolveLanguage(language.id.toLowerCase())?.id, language.id).toBe(language.id);
      expect(resolveLanguage(language.id.toUpperCase())?.id, language.id).toBe(language.id);
      expect(resolveLanguage(language.id.replace("-", "_"))?.id, language.id).toBe(language.id);
    }
  });

  it("resolves every declared alias to the language that declared it", () => {
    const seen = new Map<string, string>();
    for (const language of LANGUAGES) {
      for (const alias of language.aliases) {
        // An alias claimed by two languages would resolve to whichever was
        // registered last — silently, which is how Traditional became Simplified.
        expect(seen.get(alias.toLowerCase()), `alias ${alias} claimed twice`).toBeUndefined();
        seen.set(alias.toLowerCase(), language.id);
        expect(resolveLanguage(alias)?.id, `${alias} → ${language.id}`).toBe(language.id);
        expect(resolveLanguage(alias.toUpperCase())?.id, `${alias} → ${language.id}`).toBe(language.id);
      }
    }
  });

  it("has a base, a script and non-empty names for every language", () => {
    for (const language of LANGUAGES) {
      expect(language.base).toBe(language.id.split("-")[0].toLowerCase());
      expect(language.name.en.trim()).not.toBe("");
      expect(language.name.ko.trim()).not.toBe("");
      expect(language.name.native.trim()).not.toBe("");
      expect(languageScript(language.id)).toBe(language.script);
    }
  });

  it("returns undefined, not a guess, for nothing and for the unknown", () => {
    expect(resolveLanguage(undefined)).toBeUndefined();
    expect(resolveLanguage(null)).toBeUndefined();
    expect(resolveLanguage("")).toBeUndefined();
    expect(resolveLanguage("   ")).toBeUndefined();
    expect(resolveLanguage("xx-XX")).toBeUndefined();
    expect(canonicalLanguageId("xx-XX")).toBe("xx-XX");
  });
});

describe("Chinese script routing", () => {
  it.each(["zh-Hant-HK", "zh-hk", "cmn-Hant-TW", "zh-Hant", "zh-TW", "zh-tw", "zh-MO", "zh_TW"])(
    "%s is Traditional (zh-TW)",
    (tag) => {
      expect(resolveLanguage(tag)?.id).toBe("zh-TW");
    },
  );

  it.each(["zh", "zh-Hans-SG", "cmn", "zh-CN", "zh-cn", "zh-Hans", "zh-SG", "zho"])(
    "%s is Simplified (zh-CN)",
    (tag) => {
      expect(resolveLanguage(tag)?.id).toBe("zh-CN");
    },
  );

  it("keys both Chinese variants separately for every recogniser and the browser translator", () => {
    expect(sttLanguageFor("webspeech", "zh-TW")).toBe("zh-TW");
    expect(sttLanguageFor("deepgram", "zh-TW")).toBe("zh-TW");
    expect(sttLanguageFor("webspeech", "zh-CN")).toBe("zh-CN");
    expect(sttLanguageFor("deepgram", "zh-CN")).toBe("zh-CN");
    // Whisper takes one code for both; the prompt is what carries the script.
    expect(sttLanguageFor("openai", "zh-TW")).toBe("zh");
    expect(sttLanguageFor("openai", "zh-CN")).toBe("zh");
    expect(whisperPromptFor("zh-TW")).toMatch(/繁體/);
    expect(whisperPromptFor("zh-CN")).toMatch(/简体/);
    expect(whisperPromptFor("ko-KR")).toBeUndefined();
    expect(browserTranslatorTagFor("zh-TW")).toBe("zh-Hant");
    expect(browserTranslatorTagFor("zh-CN")).toBe("zh");
  });
});

describe("other aliases that used to fall through", () => {
  it("maps Filipino to the Tagalog entry and gives the browser fil-PH", () => {
    expect(resolveLanguage("fil-PH")?.id).toBe("tl-PH");
    expect(resolveLanguage("fil")?.id).toBe("tl-PH");
    expect(sttLanguageFor("webspeech", "tl-PH")).toBe("fil-PH");
  });

  it("keeps Uyghur its own language with every recogniser slot closed", () => {
    expect(resolveLanguage("uig")?.id).toBe("ug-CN");
    for (const provider of ["webspeech", "deepgram", "openai", "hf"] as const) {
      expect(sttLanguageFor(provider, "ug-CN"), provider).toBeNull();
      expect(sttLanguageFor(provider, "uig"), provider).toBeNull();
    }
    // A declared `null` is a deliberate "not offered" and must survive the defaults.
    expect(browserTranslatorTagFor("ug-CN")).toBeNull();
    expect(browserTranslatorTagFor("tl-PH")).toBeNull();
    expect(browserTranslatorTagFor("xx-XX")).toBeNull();
    // And it never bleeds into the languages it is mistaken for.
    expect(resolveLanguage("ar")?.id).toBe("ar-SA");
    expect(resolveLanguage("uz")?.id).toBe("uz-UZ");
    expect(resolveLanguage("tr")?.id).toBe("tr-TR");
  });

  it("resolves a region the registry does not list by its base language", () => {
    expect(resolveLanguage("en-IE")?.id).toBe("en-US");
    expect(resolveLanguage("ko-KP")?.id).toBe("ko-KR");
    expect(languageBase("es-AR")).toBe("es");
  });
});

describe("derived facts", () => {
  it("knows which languages write without spaces", () => {
    for (const id of ["zh-CN", "zh-TW", "ja-JP", "th-TH", "km-KH", "my-MM"]) {
      expect(isSpacelessLanguage(id), id).toBe(true);
    }
    for (const id of ["ko-KR", "en-US", "vi-VN", "ar-SA", "hi-IN"]) {
      expect(isSpacelessLanguage(id), id).toBe(false);
    }
  });

  it("gives English display names for prompts and errors", () => {
    expect(languageDisplayName("zh-Hant-HK")).toBe("Chinese (Traditional)");
    expect(languageDisplayName("ug")).toBe("Uyghur");
    expect(languageDisplayName("xx-XX")).toBe("xx-XX");
  });

  it("suggests only registry languages from navigator.languages", () => {
    expect(suggestLanguageId(["xx-XX", "zh-Hant-HK", "en-US"])).toBe("zh-TW");
    expect(suggestLanguageId(["xx-XX"])).toBe("en-US");
    expect(suggestLanguageId(undefined, "ko-KR")).toBe("ko-KR");
  });
});

describe("language pairs", () => {
  it("never returns a pair whose two sides are the same language", () => {
    expect(canonicalPair({ source: "zh-tw", target: "zh-tw" })).toEqual({
      source: "zh-TW",
      target: "en-US",
    });
    expect(canonicalPair({ source: "en-US", target: "en" })).toEqual({
      source: "en-US",
      target: "ko-KR",
    });
    expect(canonicalPair({ source: "ko", target: "kor" })).toEqual({
      source: "ko-KR",
      target: "en-US",
    });
  });

  it("falls back to Korean → English for nothing or the unknown", () => {
    expect(canonicalPair(undefined)).toEqual({ source: "ko-KR", target: "en-US" });
    expect(canonicalPair({ source: "xx", target: "yy" })).toEqual({ source: "ko-KR", target: "en-US" });
    expect(isKoreanToEnglish(canonicalPair(undefined))).toBe(true);
    expect(isKoreanToEnglish({ source: "zh-TW", target: "ko-KR" })).toBe(false);
  });

  it("labels a pair compactly, keeping the Chinese script visible", () => {
    expect(pairLabel({ source: "zh-TW", target: "ko-KR" })).toBe("ZH-TW → KO");
    expect(pairLabel({ source: "ko-KR", target: "en-US" })).toBe("KO → EN");
    expect(pairLabel({ source: "zh-CN", target: "en-US" })).toBe("ZH-CN → EN");
  });
});
