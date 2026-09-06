import { describe, expect, it } from "vitest";
import { extractCriticalValues, validateTranslationIntegrity } from "./integrity";
import { detectRisks } from "./risks";
import { RESIDENCE_STATUS_CODES, isResidenceStatusCode } from "./domain-vocabulary";

const kinds = (text: string, language?: string) =>
  extractCriticalValues(text, language).map((value) => `${value.kind}:${value.normalized}`);

describe("residence status codes as critical values", () => {
  it("extracts the whole code, not just its digit", () => {
    expect(kinds("I want E-7", "en-US")).toContain("status-code:E-7");
    expect(kinds("D-2에서 D-10으로", "ko-KR")).toEqual(
      expect.arrayContaining(["status-code:D-2", "status-code:D-10"]),
    );
  });

  it("catches a changed visa letter, which every numeric check misses", () => {
    // The whole reason this kind exists: to the integer extractor, E-7 and
    // F-7 are both "7", so a translation that changed which visa someone
    // holds used to pass as verified.
    const result = validateTranslationIntegrity(
      "I want to change to E-7",
      "F-2로 변경하고 싶습니다",
      "en-US",
      "ko-KR",
    );
    expect(result.status).toBe("mismatch");
    expect(result.issues[0]).toMatchObject({
      kind: "status-code",
      sourceText: "E-7",
      targetText: "F-2",
      reason: "changed",
    });
  });

  it("also catches a code corrupted into one that does not exist", () => {
    // F-7 is not a residence status, so it is not recognised as a code at
    // all — and the source's E-7 is reported missing, which is the right
    // answer for a translation that produced a category nobody can hold.
    const result = validateTranslationIntegrity(
      "I want to change to E-7",
      "F-7으로 변경하고 싶습니다",
      "en-US",
      "ko-KR",
    );
    expect(result.status).toBe("mismatch");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "status-code", sourceText: "E-7", reason: "missing" }),
    );
  });

  it("catches a dropped code", () => {
    const result = validateTranslationIntegrity(
      "I want to change from D-2 to D-10",
      "체류자격을 변경하고 싶습니다",
      "en-US",
      "ko-KR",
    );
    expect(result.status).toBe("mismatch");
    expect(result.issues.filter((issue) => issue.kind === "status-code")).toHaveLength(2);
  });

  it("passes a faithful code translation", () => {
    expect(
      validateTranslationIntegrity(
        "I want to change from D-2 to D-10",
        "체류자격을 D-2에서 D-10으로 변경하고 싶습니다",
        "en-US",
        "ko-KR",
      ).status,
    ).toBe("verified");
  });

  it("does not treat every letter-digit pair as a visa", () => {
    expect(kinds("Please bring A4 paper", "en-US")).not.toContain("status-code:A-4");
    expect(isResidenceStatusCode("A", "4")).toBe(false);
    expect(isResidenceStatusCode("E", "7")).toBe(true);
  });

  it("covers the whole published code list", () => {
    for (const code of RESIDENCE_STATUS_CODES) {
      expect(kinds(`status ${code} here`, "en-US"), code).toContain(`status-code:${code}`);
    }
  });

  it("highlights a status code for read-back", () => {
    const risks = detectRisks("Please apply for D-10 by May 31");
    expect(risks.some((risk) => risk.kind === "status-code" && risk.text === "D-10")).toBe(true);
  });
});

describe("negation as an integrity finding", () => {
  it("flags a translation that dropped the negation", () => {
    const result = validateTranslationIntegrity(
      "I did not change my workplace",
      "어제 근무처를 변경했습니다",
      "en-US",
      "ko-KR",
    );
    expect(result.status).toBe("mismatch");
    expect(result.issues[0].kind).toBe("negation");
    expect(result.issues[0].reason).toBe("missing");
  });

  it("flags a translation that invented one", () => {
    const result = validateTranslationIntegrity(
      "I changed my workplace",
      "근무처를 변경하지 않았습니다",
      "en-US",
      "ko-KR",
    );
    expect(result.issues.some((issue) => issue.kind === "negation" && issue.reason === "added")).toBe(
      true,
    );
  });

  it("does not fire on a faithful translation", () => {
    expect(
      validateTranslationIntegrity(
        "I did not change my workplace",
        "근무처를 변경하지 않았습니다",
        "en-US",
        "ko-KR",
      ).status,
    ).toBe("verified");
    expect(
      validateTranslationIntegrity(
        "예약을 하지 못하셨나요?",
        "Were you unable to make an appointment?",
        "ko-KR",
        "en-US",
      ).issues.some((issue) => issue.kind === "negation"),
    ).toBe(false);
  });

  it("stays quiet for a language pair it cannot check honestly", () => {
    expect(
      validateTranslationIntegrity(
        "I did not change my workplace",
        "Men ish joyimni o'zgartirmadim",
        "en-US",
        "uz-UZ",
      ).issues.some((issue) => issue.kind === "negation"),
    ).toBe(false);
  });
});
