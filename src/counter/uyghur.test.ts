import { describe, expect, it } from "vitest";
import { COUNTER_LANGUAGES, findLanguage, languageName, normaliseLanguageTag, suggestLanguage } from "./languages";
import { buildCounterPrompt } from "./prompt";
import { stringsFor } from "./ui-strings";
import { validateTranslationIntegrity } from "./integrity";
import { counterVoiceOffered, sttLanguageSupport } from "@/providers/stt/capability";
import { voiceStringsFor } from "@/features/counter/voice-strings";
import { voiceDetailStringsFor } from "@/features/counter/voice-detail-strings";
import { sessionEndCopy } from "@/features/counter/session-end-copy";
import { segmentLtrRuns } from "@/lib/bidi";

const UYGHUR = "ug-CN";

describe("Uyghur is its own language, not a variant of a neighbour", () => {
  it("is on the list with its own endonym, script direction and name", () => {
    const language = findLanguage(UYGHUR);
    expect(language).toBeDefined();
    expect(language?.code).toBe("ug-CN");
    expect(language?.endonym).toBe("ئۇيغۇرچە");
    expect(language?.en).toBe("Uyghur");
    expect(language?.rtl).toBe(true);
    expect(languageName(UYGHUR)).toBe("Uyghur");
    expect(COUNTER_LANGUAGES.some((entry) => entry.code === UYGHUR)).toBe(true);
  });

  it.each(["ug", "ug-CN", "ug-cn", "UG", "ug-Arab", "ug-Arab-CN", "ug-Latn", "uig", "ug_CN"])(
    "normalises the tag %s to the Uyghur entry",
    (tag) => {
      expect(findLanguage(tag)?.code).toBe(UYGHUR);
      expect(normaliseLanguageTag(tag)).toBe(UYGHUR);
    },
  );

  it.each(["ar-SA", "ar", "uz-UZ", "uz", "tr-TR", "tr"])(
    "does not let %s resolve to Uyghur, or the reverse",
    (tag) => {
      expect(findLanguage(tag)?.code).not.toBe(UYGHUR);
    },
  );

  it("is picked from a browser that asks for it", () => {
    expect(suggestLanguage(["ug-CN", "zh-CN"])).toBe(UYGHUR);
    expect(suggestLanguage(["ug"])).toBe(UYGHUR);
    // And an Arabic browser still gets Arabic.
    expect(suggestLanguage(["ar-EG"])).toBe("ar-SA");
  });

  it("has its own interface, not an English or Arabic one", () => {
    expect(stringsFor(UYGHUR).send).toBe("ئەۋەتىش");
    expect(stringsFor(UYGHUR)).not.toEqual(stringsFor("en-US"));
    expect(stringsFor(UYGHUR)).not.toEqual(stringsFor("ar-SA"));
    expect(voiceStringsFor(UYGHUR).speak).not.toBe(voiceStringsFor("ar-SA").speak);
    expect(voiceDetailStringsFor(UYGHUR).stopAria.trim()).not.toBe("");
    expect(sessionEndCopy(UYGHUR).endAction.trim()).not.toBe("");
  });
});

describe("Uyghur speech routing", () => {
  it("is not sent to any recogniser that cannot transcribe it", () => {
    for (const provider of ["deepgram", "openai", "webspeech", "hf"] as const) {
      expect(sttLanguageSupport(provider, UYGHUR)).toBe("unsupported");
    }
    expect(counterVoiceOffered(UYGHUR)).toBe(false);
  });

  it("still says, in Uyghur, what to do instead", () => {
    const copy = voiceStringsFor(UYGHUR).failure("unsupported-language");
    expect(copy).toBeTruthy();
    expect(copy).toBe(voiceStringsFor(UYGHUR).failure("unavailable"));
    // Uyghur script, not a silent English fallback.
    expect(copy).toMatch(/[؀-ۿ]/);
  });
});

describe("Uyghur translation prompting", () => {
  const prompt = (text: string, target: string, source: string) =>
    buildCounterPrompt({
      text,
      sourceLang: source,
      targetLang: target,
      inputMode: "text",
      profileId: "immigration",
      from: source === "ko-KR" ? "host" : "guest",
    });

  it("states the language pair explicitly instead of relying on detection", () => {
    expect(prompt("여권을 보여 주세요", UYGHUR, "ko-KR")).toContain(
      "TRANSLATE FROM Korean (ko-KR) INTO Uyghur (ug-CN)",
    );
    expect(prompt("I need an extension", "ko-KR", UYGHUR)).toContain(
      "TRANSLATE FROM Uyghur (ug-CN) INTO Korean (ko-KR)",
    );
  });

  it("forbids the three languages Uyghur is most often mistaken for", () => {
    const built = prompt("여권을 보여 주세요", UYGHUR, "ko-KR");
    expect(built).toContain("NOT Arabic");
    expect(built).toContain("NOT Uzbek");
    expect(built).toContain("NOT Turkish");
    expect(built).toContain("Perso-Arabic script");
  });

  it("refuses to present an improvised administrative term as the official one", () => {
    // There is no published Uyghur terminology for Korean immigration
    // procedures, and a model will happily produce a different fluent guess
    // every turn. Freezing one of those into a glossary would make an
    // invention look authoritative.
    expect(prompt("체류자격 변경허가", UYGHUR, "ko-KR")).toContain(
      "NO ESTABLISHED ADMINISTRATIVE VOCABULARY",
    );
    // Korean→English has published terms, so it gets the glossary instead.
    expect(
      buildCounterPrompt({
        text: "체류기간 연장허가를 신청하세요",
        sourceLang: "ko-KR",
        targetLang: "en-US",
        inputMode: "text",
        profileId: "immigration",
      }),
    ).not.toContain("NO ESTABLISHED ADMINISTRATIVE VOCABULARY");
  });

  it("names the codes that have to come back unchanged", () => {
    const built = prompt("체류자격을 D-2에서 D-10으로 변경하시겠어요?", UYGHUR, "ko-KR");
    expect(built).toContain("REPRODUCE VERBATIM");
    expect(built).toContain("D-2");
    expect(built).toContain("D-10");
  });
});

describe("Uyghur rendering", () => {
  it("isolates Latin administrative runs so they keep their order", () => {
    const line = "مەن D-2 دىن D-10 غا ئۆزگەرتىمەن";
    const ltr = segmentLtrRuns(line).filter((segment) => segment.kind === "ltr");
    expect(ltr.map((segment) => segment.text)).toEqual(["D-2", "D-10"]);
    expect(segmentLtrRuns(line).map((segment) => segment.text).join("")).toBe(line);
  });

  it("keeps HiKorea, ARC and an ISO date intact", () => {
    for (const token of ["HiKorea", "ARC", "2026-05-31"]) {
      const runs = segmentLtrRuns(`ئۇچۇر ${token} توغرىسىدا`)
        .filter((segment) => segment.kind === "ltr")
        .map((segment) => segment.text);
      expect(runs).toEqual([token]);
    }
  });
});

describe("Uyghur integrity checking", () => {
  it("still catches a changed status code in an Uyghur translation", () => {
    const result = validateTranslationIntegrity(
      "체류자격을 E-7로 변경하세요",
      "ھۆججەتنى F-7 گە ئۆزگەرتىڭ",
      "ko-KR",
      UYGHUR,
    );
    expect(result.status).toBe("mismatch");
    expect(result.issues.some((issue) => issue.kind === "status-code")).toBe(true);
  });

  it("passes an Uyghur translation that keeps the code and the date", () => {
    const result = validateTranslationIntegrity(
      "E-7 · 2026-05-31",
      "E-7 · 2026-05-31",
      "ko-KR",
      UYGHUR,
    );
    expect(result.status).toBe("verified");
  });
});
