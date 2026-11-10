import { describe, expect, it } from "vitest";
import { ADMIN_CONCEPTS, REGISTRY_LANGUAGES, findConcept, registryLanguage } from "./registry";
import { matchConcepts, sensitiveDataClassIn } from "./matcher";
import { analyzeUtterance, detectAmbiguities, AMBIGUITY_RULES } from "./meaning";
import { promptTerminology } from "./prompt-terms";
import { detectCounterProfile } from "../profile-detection";
import { buildCounterPrompt } from "../prompt";
import { IMMIGRATION_GLOSSARY, sttKeyterms } from "../domain-vocabulary";

const REQUIRED_CONCEPTS = [
  "foreigner-registration",
  "residence-card",
  "stay-extension",
  "status-change",
  "activity-permission",
  "workplace-change",
  "residence-change",
  "reentry-permit",
  "card-reissuance",
  "application",
  "acceptance",
  "approval",
  "rejection",
  "reporting",
  "departure-deadline",
  "departure-order",
  "deportation",
  "refugee-application",
  "refugee-recognition",
  "humanitarian-stay",
  "appointment",
  "fee",
];

describe("administrative concept registry — honesty invariants", () => {
  it("covers every concept the specification names", () => {
    for (const id of REQUIRED_CONCEPTS) expect(findConcept(id), id).toBeDefined();
  });

  it("has unique, stable ids", () => {
    const ids = ADMIN_CONCEPTS.map((concept) => concept.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z-]+$/);
  });

  it("covers all ten priority languages for every concept", () => {
    for (const concept of ADMIN_CONCEPTS) {
      for (const lang of REGISTRY_LANGUAGES) {
        expect(concept.terms[lang], `${concept.id}/${lang}`).toBeDefined();
      }
    }
  });

  it("never labels a term verified without a named reviewer and a dated source", () => {
    for (const concept of ADMIN_CONCEPTS) {
      for (const term of Object.values(concept.terms)) {
        if (term!.status !== "verified") continue;
        expect(concept.review.state).toBe("reviewed");
        expect(concept.review.reviewer).toBeTruthy();
        expect(concept.reference.revisedOn).toBeTruthy();
      }
    }
  });

  it("marks every language other than Korean and English as provisional", () => {
    for (const concept of ADMIN_CONCEPTS) {
      for (const [lang, term] of Object.entries(concept.terms)) {
        if (lang === "ko" || lang === "en") continue;
        expect(term!.status, `${concept.id}/${lang}`).toBe("provisional");
      }
    }
  });

  it("records no human review that did not happen", () => {
    for (const concept of ADMIN_CONCEPTS) expect(concept.review.state).toBe("not-reviewed");
  });

  it("cites statute only with an article and a check date", () => {
    for (const concept of ADMIN_CONCEPTS) {
      if (!concept.koBasis) continue;
      expect(concept.koBasis.article).toMatch(/^제\d+조/);
      expect(concept.koBasis.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("keeps confusable links pointing at real concepts", () => {
    for (const concept of ADMIN_CONCEPTS) {
      for (const other of concept.confusableWith ?? []) expect(findConcept(other), `${concept.id}→${other}`).toBeDefined();
    }
  });

  it("no longer calls a workplace change a mere report (출입국관리법 제21조)", () => {
    const entry = IMMIGRATION_GLOSSARY.find((item) => item.ko.startsWith("근무처"));
    expect(entry?.en).toBe("change or addition of workplace");
    expect(findConcept("workplace-change")!.restrictions?.join(" ")).toContain("제21조");
  });

  it("maps BCP-47 tags to registry languages, splitting Chinese by script", () => {
    expect(registryLanguage("zh-CN")).toBe("zh-Hans");
    expect(registryLanguage("zh-TW")).toBe("zh-Hant");
    expect(registryLanguage("zh-Hant-HK")).toBe("zh-Hant");
    expect(registryLanguage("uz-UZ")).toBe("uz");
    expect(registryLanguage("fr-FR")).toBeNull();
  });
});

describe("deterministic concept matching", () => {
  it("recognises 登录证 as a colloquial reference to the residence card", () => {
    const [match] = matchConcepts("我想延期登录证。", "zh-CN");
    expect(match).toMatchObject({ conceptId: "residence-card", kind: "colloquial", text: "登录证" });
  });

  it("prefers the longest match: 'visa extension' is one mention, not 'visa' plus noise", () => {
    const matches = matchConcepts("I need a visa extension.", "en-US");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ conceptId: "stay-extension", kind: "colloquial" });
  });

  it("distinguishes rejection from approval when the negative contains the positive", () => {
    expect(matchConcepts("It was not approved.", "en-US").map((m) => m.conceptId)).toEqual(["rejection"]);
    expect(matchConcepts("불허가 결정이 났습니다", "ko-KR").map((m) => m.conceptId)).toEqual(["rejection"]);
  });

  it("matches inflected Russian forms by stem and Latin words by whole word", () => {
    expect(matchConcepts("Мне нужно продлить визу", "ru-RU")[0]?.conceptId).toBe("stay-extension");
    // "fee" must not match inside "feeling".
    expect(matchConcepts("I am feeling fine", "en-US")).toEqual([]);
  });

  it("finds Korean terms inside visitor speech in another language (code-switching)", () => {
    expect(matchConcepts("Tôi mang 외국인등록증 rồi", "vi-VN")[0]?.conceptId).toBe("residence-card");
  });

  it("does not treat moving into a director's office as moving house", () => {
    expect(matchConcepts("이사님께 전달해 주세요", "ko-KR")).toEqual([]);
  });
});

describe("Administrative Meaning Layer — ambiguity", () => {
  const rule = (text: string, lang: string, recent?: { text: string; lang?: string }[]) =>
    detectAmbiguities({ text, lang, recent }).map((finding) => finding.ruleId);

  it("flags the specification example without choosing a procedure", () => {
    const analysis = analyzeUtterance({ text: "我想延期登录证。", lang: "zh-CN", otherLang: "ko-KR" });
    expect(analysis.ambiguities).toHaveLength(1);
    const [finding] = analysis.ambiguities;
    expect(finding.ruleId).toBe("card-or-stay-extension");
    expect(finding.candidates.map((c) => c.conceptId).sort()).toEqual(["card-reissuance", "stay-extension"]);
    expect(analysis.clarifications[0].ko).toMatch(/\?$/);
    // Neutral: the question offers both candidates rather than presupposing one.
    expect(analysis.clarifications[0].ko).toContain("체류기간");
    expect(analysis.clarifications[0].ko).toContain("외국인등록증");
    expect(analysis.uncertainty.procedural.level).toBe("present");
    expect(analysis.uncertainty.terminology.level).toBe("present");
  });

  it("does not flag an utterance that names the procedure explicitly", () => {
    expect(rule("체류기간 연장허가를 신청하러 왔어요. 외국인등록증 여기 있어요.", "ko-KR")).toEqual([]);
    expect(rule("I'd like to apply for an extension of stay; here is my residence card.", "en-US")).toEqual([]);
  });

  it("covers the procedural pairs the specification lists", () => {
    expect(rule("I want a visa extension", "en-US")).toContain("visa-extension-wording");
    expect(rule("회사 옮겼어요", "ko-KR")).toContain("job-change-scope");
    expect(rule("I got transferred last month", "en-US")).toContain("address-or-workplace");
    expect(rule("Tôi đổi công ty rồi, đã báo rồi", "vi-VN")).toContain("permission-or-report");
    expect(rule("연장 다 했어요", "ko-KR", [{ text: "체류기간 연장 때문에 왔어요" }])).toContain("stage-unclear");
    expect(rule("출국해야 하는 기한이 언제까지예요?", "ko-KR")).toContain("deadline-type");
    expect(rule("I got my refugee status already", "en-US")).toContain("refugee-outcome");
    expect(rule("Here is my visa card", "en-US")).toContain("visa-means-card");
  });

  it("does not run ambiguity detection on staff turns when told not to", () => {
    const analysis = analyzeUtterance({ text: "회사 옮기셨으면 신고하셔야 해요", lang: "ko-KR", detectAmbiguity: false });
    expect(analysis.ambiguities).toEqual([]);
    expect(analysis.terms.length).toBeGreaterThan(0);
  });

  it("separates the four uncertainty dimensions", () => {
    const voice = analyzeUtterance({ text: "여권 주세요", lang: "ko-KR", inputMode: "voice", modelConfidence: "high", checks: "passed" });
    expect(voice.uncertainty.acoustic.level).toBe("unmeasured");
    expect(voice.uncertainty.translation.level).toBe("none-detected");
    expect(voice.uncertainty.translation.reason).toContain("사람 검토 아님");
    const typed = analyzeUtterance({ text: "여권 주세요", lang: "ko-KR", inputMode: "text", modelConfidence: "high", checks: "unverified" });
    expect(typed.uncertainty.acoustic.level).toBe("not-applicable");
    expect(typed.uncertainty.translation.level).toBe("unmeasured");
  });

  it("every rule has a Korean and English question ending in a question mark", () => {
    for (const r of AMBIGUITY_RULES) {
      expect(r.question.ko.trim()).toMatch(/\?$/);
      expect(r.question.en.trim()).toMatch(/\?$/);
      expect(r.candidates.length).toBeGreaterThan(1);
    }
  });
});

describe("terminology retrieval for the prompt", () => {
  it("sends nothing when the turn uses no administrative concept", () => {
    expect(promptTerminology({ text: "잠시만 기다려 주세요", sourceLang: "ko-KR", targetLang: "en-US" })).toEqual([]);
  });

  it("sends only the concepts in use, with provisional target renderings labelled", () => {
    const lines = promptTerminology({ text: "체류기간 연장허가 신청하시려면", sourceLang: "ko-KR", targetLang: "vi-VN" });
    const block = lines.join("\n");
    expect(block).toContain("체류기간 연장허가 = extension of period of stay = gia hạn thời gian lưu trú (provisional");
    expect(block).not.toContain("deportation");
  });

  it("tells the model not to resolve colloquial wording into an official procedure", () => {
    const prompt = buildCounterPrompt({
      text: "我想延期登录证。",
      sourceLang: "zh-CN",
      targetLang: "ko-KR",
      profileId: "immigration",
      from: "guest",
    });
    expect(prompt).toContain('NON-STANDARD WORDING IN THIS UTTERANCE: "登录证"');
    expect(prompt).toContain("do NOT decide which procedure they mean");
  });

  it("keeps the general profile's prompt free of registry terminology", () => {
    const prompt = buildCounterPrompt({ text: "체류기간 연장", sourceLang: "ko-KR", targetLang: "en-US", profileId: "hospital" });
    expect(prompt).not.toContain("ADMINISTRATIVE TERMS IN USE");
  });
});

describe("recogniser hints from the registry", () => {
  it("adds visitor-language terms for priority languages, bounded", () => {
    const hints = sttKeyterms("zh-CN", "immigration");
    expect(hints).toContain("外国人登录证");
    expect(hints).toContain("登录证");
    expect(hints.length).toBeLessThanOrEqual(28);
  });

  it("still returns nothing for non-administrative desks", () => {
    expect(sttKeyterms("zh-CN", "hotel")).toEqual([]);
  });
});

describe("privacy audit — sensitive concepts route to sensitive profiles", () => {
  it("classifies every surface form of every refugee/enforcement concept as sensitive", () => {
    const misses: string[] = [];
    for (const concept of ADMIN_CONCEPTS) {
      if (concept.dataClass === "general") continue;
      for (const [lang, term] of Object.entries(concept.terms)) {
        for (const form of [term!.term, ...(term!.forms ?? [])]) {
          if (detectCounterProfile({ text: form }) !== concept.dataClass) misses.push(`${concept.id}/${lang}/${form}`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it("catches the previously missed humanitarian-stay wording", () => {
    expect(detectCounterProfile({ text: "인도적 체류 허가 받았어요" })).toBe("refugee");
    expect(detectCounterProfile({ text: "I have humanitarian stay" })).toBe("refugee");
    expect(sensitiveDataClassIn("Tôi có giấy phép lưu trú nhân đạo")).toBe("refugee");
  });

  it("keeps an ordinary immigration turn non-sensitive", () => {
    expect(detectCounterProfile({ text: "체류기간 연장하러 왔어요" })).toBe("immigration");
    expect(sensitiveDataClassIn("체류기간 연장하러 왔어요")).toBeNull();
  });
});
