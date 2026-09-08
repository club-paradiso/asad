import { describe, expect, it } from "vitest";
import { COUNTER_LANGUAGES, findLanguage, languageName } from "./languages";
import { buildCounterPrompt } from "./prompt";
import { deepgramLanguage, webSpeechLanguage } from "@/providers/stt/language";
import {
  counterSpeechPlan,
  counterVoiceSupport,
  sttLanguageSupport,
} from "@/providers/stt/capability";
import { voiceStringsFor } from "@/features/counter/voice-strings";

const intentionallyBatchOnly = new Set(["uz-UZ", "km-KH", "my-MM"]);

/**
 * Languages Counter Mode deliberately offers as typed-input only.
 *
 * Uyghur is here because no recogniser in the configured stack transcribes it.
 * That is a product fact, not an omission: pretending otherwise would hand a
 * visitor a microphone that cannot work and no way to find out why.
 */
const intentionallyTypedOnly = new Set(["ug-CN"]);

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
      if (intentionallyBatchOnly.has(language.code) || intentionallyTypedOnly.has(language.code)) {
        expect(deepgramLanguage(language.code)).toBeNull();
      } else {
        expect(deepgramLanguage(language.code)).not.toBeNull();
      }

      // A language is either transcribable somewhere in the stack or explicitly
      // typed-only. There is no third state, because the third state is a mic
      // button that spins forever.
      if (intentionallyTypedOnly.has(language.code)) {
        expect(counterSpeechPlan(language.code)).toEqual([]);
        expect(counterVoiceSupport(language.code)).toBe("unsupported");
      } else {
        expect(counterSpeechPlan(language.code).length).toBeGreaterThan(0);
        expect(counterVoiceSupport(language.code)).not.toBe("unsupported");
      }

      // Voice copy still has to exist: the visitor is told why typing is the
      // path here, in their own language.
      const copy = voiceStringsFor(language.code);
      expect(copy.speak.trim()).not.toBe("");
      expect(copy.connecting.trim()).not.toBe("");
      expect(copy.listening.trim()).not.toBe("");
      expect(copy.finishing.trim()).not.toBe("");
      expect(copy.translating.trim()).not.toBe("");
      expect(copy.speakAgain.trim()).not.toBe("");
    },
  );

  it("never routes Uyghur to a recogniser that cannot transcribe it", () => {
    // Every one of these is a plausible mis-routing: Uyghur shares its script
    // with Arabic, its language family with Uzbek and Turkish, and its tag
    // prefix with nothing at all. Sending `ug` to a Whisper-family model does
    // not produce Uyghur; it produces fluent text in a neighbouring language.
    for (const provider of ["deepgram", "openai", "webspeech", "hf"] as const) {
      expect(sttLanguageSupport(provider, "ug-CN")).toBe("unsupported");
      expect(sttLanguageSupport(provider, "ug")).toBe("unsupported");
    }
    expect(deepgramLanguage("ug-CN")).toBeNull();
    expect(deepgramLanguage("ug")).toBeNull();

    // The neighbours must stay reachable — this is not a blanket block.
    expect(counterVoiceSupport("ar-SA")).not.toBe("unsupported");
    expect(counterVoiceSupport("uz-UZ")).not.toBe("unsupported");
    expect(counterVoiceSupport("tr-TR")).not.toBe("unsupported");
  });

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
    // The pair is stated with both the names and the tags, and detection is
    // explicitly disabled: guessing is how a French turn became a non-French
    // one in production.
    expect(prompt).toContain("TRANSLATE FROM French (fr-FR) INTO Korean (ko-KR).");
    expect(prompt).toContain("Do not auto-detect the language");
  });
});
