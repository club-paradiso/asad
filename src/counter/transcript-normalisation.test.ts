import { describe, expect, it } from "vitest";
import { normaliseTranscript } from "./transcript-normalisation";

const en = (text: string) => normaliseTranscript(text, { language: "en-US" });
const ko = (text: string) => normaliseTranscript(text, { language: "ko-KR" });

describe("transcript normalisation", () => {
  describe("never changes what was said", () => {
    // These are the assertions that matter. Everything else in this file is a
    // convenience; these are the ones that make the layer safe to run at all.
    it.each([
      "I didn't change my workplace",
      "I did not change my workplace",
      "I have no residence card",
      "I never reported it",
      "I cannot come before May 31",
      "I don't have an appointment",
    ])("preserves English negation in %s", (text) => {
      const result = en(text);
      expect(result.toLowerCase()).toMatch(/n['’]t|\bnot\b|\bno\b|\bnever\b|cannot/);
    });

    it.each([
      "회사 안 바꿨어요",
      "신고를 하지 않았습니다",
      "예약을 못 했어요",
      "외국인등록증이 없습니다",
      "아니요, 변경하지 않았습니다",
    ])("preserves Korean negation in %s", (text) => {
      expect(ko(text)).toMatch(/안|않|못|없|아니/);
    });

    it("does not complete an unfinished sentence", () => {
      expect(en("I want to extend my")).toBe("I want to extend my");
    });

    it("does not invent a date, a number, or a deadline", () => {
      const result = en("I changed my workplace last week");
      expect(result).toBe("I changed my workplace last week");
      expect(result).not.toMatch(/\d/);
    });
  });

  describe("residence status codes", () => {
    it("canonicalises every written form of a real status", () => {
      expect(en("my status is E7")).toBe("my status is E-7");
      expect(en("my status is e-7")).toBe("my status is E-7");
      expect(en("change from D2 to D10 status")).toBe("change from D-2 to D-10 status");
    });

    it("keeps the order of a range", () => {
      // The literal case from the brief. Order is meaning here.
      expect(en("I want to change from D two to D ten")).toBe(
        "I want to change from D-2 to D-10",
      );
    });

    it("only expands a spoken code inside an administrative sentence", () => {
      expect(en("Take exit E seven please")).toBe("Take exit E seven please");
      expect(en("my visa is E seven")).toBe("my visa is E-7");
    });

    it("leaves letter-number pairs that are not real statuses alone", () => {
      // A-4 is a paper size; there is no A-4 residence status.
      expect(en("I need A4 paper")).toBe("I need A4 paper");
      expect(en("row H9 seat")).toBe("row H9 seat");
    });

    it("works inside Korean, where particles attach to the code", () => {
      expect(ko("체류자격을 D2에서 D10으로 변경하고 싶어요")).toBe(
        "체류자격을 D-2에서 D-10으로 변경하고 싶어요",
      );
    });
  });

  describe("numbers and dates", () => {
    it("writes a spoken date in digits so it can be checked", () => {
      expect(en("My visa expires on May thirty first")).toBe("My visa expires on May 31");
      expect(en("come back on June twenty three")).toBe("come back on June 23");
    });

    it("writes a spoken duration in digits", () => {
      expect(en("I need three months")).toBe("I need 3 months");
      expect(en("twenty one days")).toBe("21 days");
    });

    it("leaves a number word that is not a quantity", () => {
      expect(en("one moment please")).toBe("one moment please");
    });
  });

  describe("cleanup", () => {
    it("collapses a repeated filler but keeps a single one", () => {
      expect(en("uh uh uh extension")).toBe("uh extension");
      expect(en("uh extension")).toBe("uh extension");
    });

    it("tidies spacing and stray punctuation without losing any", () => {
      expect(en("I  need   help .")).toBe("I need help.");
      expect(en("really?????")).toBe("really?");
    });

    it("normalises the names that are one token in the real world", () => {
      expect(en("book it on hi korea")).toBe("book it on HiKorea");
      expect(en("I lost my arc card for my visa")).toBe("I lost my ARC card for my visa");
      // "arc" stays a common noun outside an administrative sentence.
      expect(en("draw an arc here")).toBe("draw an arc here");
    });

    it("returns empty for empty input rather than inventing filler", () => {
      expect(en("   ")).toBe("");
    });
  });
});
