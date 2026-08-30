import { describe, expect, it } from "vitest";
import { extractCriticalValues, validateTranslationIntegrity } from "./integrity";

describe("critical-value extraction", () => {
  it("extracts integers and decimals without double-claiming", () => {
    const values = extractCriticalValues("창구 12에서 1.5시간 기다리세요.");
    expect(values.map(({ kind, normalized }) => [kind, normalized])).toEqual([
      ["integer", "12"],
      ["decimal", "1.5"],
    ]);
  });

  it("normalizes money, phones, long IDs, and document codes", () => {
    const values = extractCriticalValues("수수료는 ₩50,000이고 전화는 010-1234-5678, 번호는 AB-123456입니다.");
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "money", normalized: "KRW:50000" }),
        expect.objectContaining({ kind: "phone", normalized: "01012345678" }),
        expect.objectContaining({ kind: "identifier", normalized: "AB123456" }),
      ]),
    );
  });

  it("extracts conservative Latin proper names", () => {
    expect(extractCriticalValues("Please ask for Kim Min Su.")).toContainEqual({
      kind: "name",
      text: "Kim Min Su",
      normalized: "kimminsu",
    });
    expect(extractCriticalValues("Thank You for waiting.").some((value) => value.kind === "name")).toBe(false);
  });
});

describe("translation integrity", () => {
  it("understands equivalent Korean, English, and ISO dates", () => {
    expect(
      validateTranslationIntegrity(
        "기한은 2026년 9월 7일입니다.",
        "The deadline is September 7, 2026.",
      ).status,
    ).toBe("verified");
    expect(
      validateTranslationIntegrity("기한은 2026-09-07입니다.", "The deadline is 7 September 2026.").status,
    ).toBe("verified");
    expect(validateTranslationIntegrity("9월 7일까지 오세요.", "Please come by September 7.").status).toBe(
      "verified",
    );
  });

  it("detects a changed date", () => {
    const result = validateTranslationIntegrity(
      "기한은 2026년 9월 7일입니다.",
      "The deadline is September 17, 2026.",
    );
    expect(result.status).toBe("mismatch");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "date", reason: "changed", sourceText: "2026년 9월 7일" }),
    );
  });

  it("understands equivalent clock formats", () => {
    expect(
      validateTranslationIntegrity("오후 3시 30분에 오세요.", "Please come at 3:30 PM.").status,
    ).toBe("verified");
    expect(
      validateTranslationIntegrity("오후 3시 30분에 오세요.", "Please come at 4:30 PM.").status,
    ).toBe("mismatch");
  });

  it("understands equivalent currency and decimal formatting", () => {
    expect(validateTranslationIntegrity("수수료는 ₩50,000입니다.", "The fee is 50,000 KRW.").status).toBe("verified");
    expect(validateTranslationIntegrity("무게는 1.5kg입니다.", "The weight is 1,5 kg.").status).toBe("verified");
  });

  it("normalizes phone and document-code punctuation", () => {
    expect(
      validateTranslationIntegrity(
        "전화번호는 010-1234-5678이고 접수번호는 AB-123456입니다.",
        "The phone number is 010 1234 5678 and the reference is AB123456.",
      ).status,
    ).toBe("verified");
  });

  it("requires a Latin spelling of a source proper name to survive", () => {
    expect(
      validateTranslationIntegrity("My name is Kim Min Su.", "제 이름은 김민수(Kim Min Su)입니다.").status,
    ).toBe("verified");
    const missing = validateTranslationIntegrity("My name is Kim Min Su.", "제 이름은 김민수입니다.");
    expect(missing.issues).toContainEqual(
      expect.objectContaining({ kind: "name", reason: "missing", sourceText: "Kim Min Su" }),
    );
  });

  it("flags critical values added only by the translation", () => {
    const result = validateTranslationIntegrity("Please wait here.", "Please wait at counter 7.");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "integer", reason: "added", targetText: "7" }),
    );
  });
});
