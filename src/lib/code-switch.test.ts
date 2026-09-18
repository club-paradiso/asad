import { describe, expect, it } from "vitest";
import {
  analyseCodeSwitch,
  guestTermsIn,
  isAlreadyTargetLanguage,
  pairIsScriptDecidable,
} from "./code-switch";

const koEn = { source: "ko-KR", target: "en-US" };

describe("what the pair can be read at all", () => {
  it("reads a pair whose scripts differ", () => {
    expect(pairIsScriptDecidable("ko-KR", "en-US")).toBe(true);
    expect(pairIsScriptDecidable("ru-RU", "en-US")).toBe(true);
    expect(pairIsScriptDecidable("en-US", "th-TH")).toBe(true);
  });

  it("refuses a pair that shares a script, rather than guessing", () => {
    // Two Latin languages cannot be told apart by looking at characters, and a
    // regex that claims otherwise is the failure this module exists to avoid.
    expect(pairIsScriptDecidable("en-US", "es-ES")).toBe(false);
    expect(pairIsScriptDecidable("es-ES", "fr-FR")).toBe(false);
    // Simplified and Traditional Chinese share the Han block.
    expect(pairIsScriptDecidable("zh-CN", "zh-TW")).toBe(false);
  });

  it("says so honestly instead of returning a confident nonsense reading", () => {
    const analysis = analyseCodeSwitch("We should ship the retention fix.", {
      source: "en-US",
      target: "es-ES",
    });
    expect(analysis.decidable).toBe(false);
    expect(analysis.dominant).toBe("unknown");
    // The guest terms are still real and still worth protecting downstream.
    expect(analysis.guestTerms).toContain("retention");
  });
});

describe("reading one stabilised unit", () => {
  it("reads ordinary Korean as Korean and finds nothing to preserve", () => {
    const analysis = analyseCodeSwitch("오늘 우리가 함께 살펴볼 내용입니다.", koEn);
    expect(analysis.dominant).toBe("source");
    expect(analysis.mixed).toBe(false);
    expect(analysis.guestTerms).toEqual([]);
  });

  it("reads a Korean sentence carrying an English noun phrase", () => {
    const analysis = analyseCodeSwitch("오늘 우리가 살펴볼 개념은 social capital입니다.", koEn);
    expect(analysis.dominant).toBe("mixed");
    expect(analysis.mixed).toBe(true);
    expect(analysis.guestTerms).toEqual(["social", "capital"]);
  });

  it("reads a full English sentence quoted inside a Korean session", () => {
    const analysis = analyseCodeSwitch("I don't think this is going to work.", koEn);
    expect(analysis.dominant).toBe("target");
    expect(isAlreadyTargetLanguage("I don't think this is going to work.", koEn)).toBe(true);
  });

  it("does not call a short fragment a target-language utterance", () => {
    // Two loan words are not a sentence the speaker delivered in English, and
    // passing them through untranslated would drop the Korean around them.
    expect(isAlreadyTargetLanguage("RAG", koEn)).toBe(false);
    expect(isAlreadyTargetLanguage("KPI", koEn)).toBe(false);
  });

  it("does not let digits decide the language", () => {
    // "KPI가 3% 올랐습니다" is Korean. Counting the 3 as evidence of English
    // would make every statistic in a lecture read as a code switch.
    const analysis = analyseCodeSwitch("KPI가 3.4% 올랐고 CAC는 12만 원입니다.", koEn);
    expect(analysis.dominant).toBe("mixed");
    expect(analysis.sourceRatio).toBeGreaterThan(analysis.targetRatio);
  });
});

describe("terms worth carrying through untouched", () => {
  it("keeps technical phrases, product names and foreign names", () => {
    expect(guestTermsIn("오늘은 retrieval augmented generation, 그러니까 RAG 구조입니다.")).toEqual([
      "retrieval",
      "augmented",
      "generation",
      "RAG",
    ]);
    expect(guestTermsIn("OpenAI와 Anthropic, DeepMind, Vercel이 있습니다.")).toEqual([
      "OpenAI",
      "Anthropic",
      "DeepMind",
      "Vercel",
    ]);
  });

  it("keeps identifiers with their hyphens and digits intact", () => {
    expect(guestTermsIn("E-7 비자와 F-2 비자는 다릅니다.")).toEqual(["E-7", "F-2"]);
    expect(guestTermsIn("서버가 HTTP 403을 반환했습니다.")).toEqual(["HTTP"]);
    expect(guestTermsIn("GPT-4o를 사용했습니다.")).toEqual(["GPT-4o"]);
  });

  it("keeps an apostrophe inside a word rather than splitting it", () => {
    // The bare "I" is dropped by the one-letter rule, and that is correct: the
    // list exists to protect terms a model or a recogniser could mangle, and
    // nothing mangles "I". "don't" surviving as a single token is the point.
    expect(guestTermsIn("그가 말했어요. “I don't know.”")).toEqual(["don't", "know"]);
  });

  it("drops a bare single letter, which is punctuation or noise", () => {
    expect(guestTermsIn("가 나 다 A 라 마")).toEqual([]);
  });

  it("de-duplicates case-insensitively so a repeated term costs one slot", () => {
    expect(guestTermsIn("RAG, rag, Rag")).toEqual(["RAG"]);
  });
});
