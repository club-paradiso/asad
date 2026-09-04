import { describe, expect, it } from "vitest";
import { COUNTER_LANGUAGES, findLanguage, languageName } from "./languages";
import { buildCounterPrompt } from "./prompt";
import { deepgramLanguage, webSpeechLanguage } from "@/providers/stt/language";
import { voiceStringsFor } from "@/features/counter/voice-strings";

const intentionallyBatchOnly = new Set(["uz-UZ", "km-KH", "my-MM"]);

describe("Counter language contract", () => {
  it("keeps every configured language uniquely addressable", () => {
    const codes = COUNTER_LANGUAGES.map((language) => language.code);
    expect(new Set(codes).size).toBe(codes.length);

    for (const language of COUNTER_LANGUAGES) {
      expect(findLanguage(language.code)).toEqual(language);
      expect(findLanguage(language.code.toLowerCase())).toEqual(language);
      expect(languageName(language.code)).toBe(language.en);
      expect(language.endonym.trim()).not.toBe("");
      expect(language.ko.trim()).not.toBe("");
      expect(language.en.trim()).not.toBe("");
    }
  });

  it.each(COUNTER_LANGUAGES)(
    "builds a valid model prompt for $en ($code) in both directions",
    (language) => {
      const outbound = buildCounterPrompt({
        text: "안녕하세요. 여권을 보여 주세요.",
        sourceLang: "ko-KR",
        targetLang: language.code,
        inputMode: "text",
      });
      const inbound = buildCounterPrompt({
        text: "test utterance",
        sourceLang: language.code,
        targetLang: "ko-KR",
        inputMode: "text",
      });

      expect(outbound).toContain(`INTO ${language.en}`);
      expect(inbound).toContain(`FROM ${language.en}`);
      expect(outbound).toContain("Return the JSON object now.");
      expect(inbound).toContain("Return the JSON object now.");
    },
  );

  it.each(COUNTER_LANGUAGES)(
    "has a usable speech-input path and non-empty voice UX copy for $en ($code)",
    (language) => {
      expect(webSpeechLanguage(language.code)).not.toBe("");
      if (intentionallyBatchOnly.has(language.code)) {
        expect(deepgramLanguage(language.code)).toBeNull();
      } else {
        expect(deepgramLanguage(language.code)).not.toBeNull();
      }

      const copy = voiceStringsFor(language.code);
      expect(copy.speak.trim()).not.toBe("");
      expect(copy.connecting.trim()).not.toBe("");
      expect(copy.listening.trim()).not.toBe("");
      expect(copy.finishing.trim()).not.toBe("");
      expect(copy.translating.trim()).not.toBe("");
      expect(copy.speakAgain.trim()).not.toBe("");
    },
  );

  it("locks the French path that triggered the production regression", () => {
    expect(findLanguage("fr-FR")?.en).toBe("French");
    expect(deepgramLanguage("fr-FR")).toBe("fr");
    expect(webSpeechLanguage("fr-FR")).toBe("fr-FR");

    const prompt = buildCounterPrompt({
      text: "Bonjour, je voudrais prolonger mon séjour.",
      sourceLang: "fr-FR",
      targetLang: "ko-KR",
      inputMode: "voice",
      profileId: "immigration",
    });
    expect(prompt).toContain("TRANSLATE FROM French INTO Korean.");
  });
});
