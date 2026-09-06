import { describe, expect, it } from "vitest";
import { COUNTER_LANGUAGES } from "@/counter/languages";
import {
  cloudSttCandidates,
  counterSpeechPlan,
  counterVoiceOffered,
  counterVoiceSupport,
  sttLanguageSupport,
} from "./capability";
import { deepgramLanguage } from "./language";

describe("STT language capability", () => {
  it("agrees with the Deepgram tag table", () => {
    for (const language of COUNTER_LANGUAGES) {
      const expected = deepgramLanguage(language.code) ? "native" : "unsupported";
      expect(sttLanguageSupport("deepgram", language.code), language.code).toBe(expected);
    }
  });

  it("never reports support for a language the browser recogniser cannot do", () => {
    for (const language of COUNTER_LANGUAGES) {
      const support = sttLanguageSupport("webspeech", language.code);
      expect(support, language.code).toBe(language.speechSupported ? "native" : "unsupported");
    }
  });

  it("marks the batch path as fallback-only however good the model is", () => {
    // It uploads one finished utterance, so there are no interim results by
    // construction. Calling that "native" would hide a real UX difference.
    expect(sttLanguageSupport("hf", "ko-KR")).toBe("fallback-only");
    expect(sttLanguageSupport("hf", "uz-UZ")).toBe("fallback-only");
  });

  it("marks thin Whisper languages experimental rather than native", () => {
    expect(sttLanguageSupport("openai", "km-KH")).toBe("experimental");
    expect(sttLanguageSupport("openai", "my-MM")).toBe("experimental");
    expect(sttLanguageSupport("openai", "ko-KR")).toBe("native");
  });

  it("orders the plan best path first and drops what cannot work", () => {
    const korean = counterSpeechPlan("ko-KR").map((entry) => entry.provider);
    expect(korean).toEqual(["deepgram", "openai", "webspeech", "hf"]);

    // Deepgram has no Uzbek and the browser recogniser is not offered for it,
    // so the plan skips straight to the paths that can actually transcribe —
    // which is the whole point: the old code spent a credential fetch and a
    // full connection timeout finding this out on every single turn.
    const uzbek = counterSpeechPlan("uz-UZ").map((entry) => entry.provider);
    expect(uzbek).toEqual(["openai", "hf"]);
    expect(uzbek).not.toContain("deepgram");
  });

  it("reports no cloud candidates for a language no streaming vendor covers", () => {
    expect(cloudSttCandidates("uz-UZ")).toEqual(["openai"]);
    expect(cloudSttCandidates("ug-CN")).toEqual([]);
  });

  it("says plainly that Uyghur has no recogniser anywhere in the stack", () => {
    expect(counterSpeechPlan("ug-CN")).toEqual([]);
    expect(counterVoiceSupport("ug-CN")).toBe("unsupported");
    expect(counterVoiceOffered("ug-CN")).toBe(false);
    // And the languages it is most often mistaken for stay unaffected.
    expect(counterVoiceOffered("ar-SA")).toBe(true);
    expect(counterVoiceOffered("uz-UZ")).toBe(true);
    expect(counterVoiceOffered("tr-TR")).toBe(true);
  });

  it("offers a microphone for every other language on the list", () => {
    for (const language of COUNTER_LANGUAGES) {
      if (language.code === "ug-CN") continue;
      expect(counterVoiceOffered(language.code), language.code).toBe(true);
    }
  });

  it("treats an unknown or empty tag as unsupported rather than guessing", () => {
    expect(counterVoiceSupport(undefined)).toBe("unsupported");
    expect(counterVoiceSupport("")).toBe("unsupported");
    expect(sttLanguageSupport("openai", "xx-XX")).toBe("unsupported");
  });
});
