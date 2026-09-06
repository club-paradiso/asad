/**
 * A deterministic quality gate for translations.
 *
 * No provider is called. Model output is not deterministic, so asserting exact
 * strings would either be flaky or would lock in one model's phrasing; what
 * this checks instead is the set of properties an administrative translation
 * must have whatever words it chooses. Each fixture is paired with a faithful
 * rendering and with the specific corruption that matters at a counter, and
 * the harness has to accept the first and reject the second.
 */
import { describe, expect, it } from "vitest";
import { validateTranslationIntegrity } from "./integrity";
import { compareNegation } from "./negation";

interface Verdict {
  ok: boolean;
  problems: string[];
}

/** Everything that must survive a turn, checked with the production code. */
function checkInvariants(
  source: string,
  target: string,
  sourceLang: string,
  targetLang: string,
): Verdict {
  const integrity = validateTranslationIntegrity(source, target, sourceLang, targetLang);
  const negation = compareNegation(source, target, sourceLang, targetLang);
  const problems = integrity.issues.map(
    (issue) => `${issue.kind}:${issue.reason}:${issue.sourceText || issue.targetText}`,
  );
  if (negation === "dropped" || negation === "added") problems.push(`negation:${negation}`);
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

const KO = "ko-KR";
const EN = "en-US";

describe("Korean → English counter fixtures", () => {
  const faithful: Array<[string, string]> = [
    ["체류기간 만료일이 언제예요?", "When is the expiration date of your period of stay?"],
    ["근무처 변경 신고를 하셔야 합니다.", "You must report the change of workplace."],
    ["예약한 날짜에 방문하셔야 합니다.", "You must visit on the date of your appointment."],
    ["외국인등록증을 분실하셨나요?", "Did you lose your residence card?"],
    [
      "체류자격을 D-2에서 D-10으로 변경하려고 하시는 건가요?",
      "Do you want to change your residence status from D-2 to D-10?",
    ],
    [
      "체류기간 만료일 전에 예약을 하지 못하셨나요?",
      "Were you unable to book an appointment before your period of stay expires?",
    ],
  ];

  it.each(faithful)("accepts a faithful rendering of %s", (source, target) => {
    const verdict = checkInvariants(source, target, KO, EN);
    expect(verdict.problems).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("rejects a translation that loses the status codes", () => {
    const verdict = checkInvariants(
      "체류자격을 D-2에서 D-10으로 변경하려고 하시는 건가요?",
      "Do you want to change your residence status?",
      KO,
      EN,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toContain("status-code:missing:D-2");
    expect(verdict.problems).toContain("status-code:missing:D-10");
  });

  it("rejects a translation that swaps a status code", () => {
    const verdict = checkInvariants(
      "체류자격을 D-2에서 D-10으로 변경하시겠어요?",
      "Do you want to change from D-2 to D-4?",
      KO,
      EN,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("status-code");
  });

  it("rejects a translation that drops the negation", () => {
    const verdict = checkInvariants(
      "체류기간 만료일 전에 예약을 하지 못하셨나요?",
      "Did you book an appointment before your period of stay expires?",
      KO,
      EN,
    );
    expect(verdict.problems).toContain("negation:dropped");
  });

  it("rejects a translation that invents a deadline nobody stated", () => {
    // The failure mode this whole file exists for: fluent, helpful-sounding,
    // and it tells someone a date that was never said.
    const verdict = checkInvariants(
      "근무처 변경 신고를 하셔야 합니다.",
      "You must report the change of workplace within 15 days.",
      KO,
      EN,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/added/);
  });
});

describe("English → Korean counter fixtures", () => {
  const faithful: Array<[string, string]> = [
    ["My visa expires on May 31.", "제 사증은 5월 31일에 만료됩니다."],
    ["I changed my workplace yesterday.", "어제 근무처를 변경했습니다."],
    ["I don't have my residence card.", "외국인등록증이 없습니다."],
    ["I want to extend my stay.", "체류기간을 연장하고 싶습니다."],
    [
      "I have an appointment but it is after my expiration date.",
      "예약은 했지만 체류기간 만료일 이후입니다.",
    ],
    ["I did not change my workplace.", "근무처를 변경하지 않았습니다."],
    ["I want to change from D-2 to D-10.", "D-2에서 D-10으로 변경하고 싶습니다."],
  ];

  it.each(faithful)("accepts a faithful rendering of %s", (source, target) => {
    const verdict = checkInvariants(source, target, EN, KO);
    expect(verdict.problems).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("rejects the negation reversal named in the brief", () => {
    // "I did not change my workplace" becoming "I changed my workplace" is the
    // single most damaging thing this product can do, and every numeric check
    // passes it.
    const verdict = checkInvariants(
      "I did not change my workplace.",
      "근무처를 변경했습니다.",
      EN,
      KO,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toContain("negation:dropped");
  });

  it("rejects a changed date", () => {
    const verdict = checkInvariants("My visa expires on May 31.", "제 사증은 5월 30일에 만료됩니다.", EN, KO);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("date");
  });

  it("rejects an invented visa category", () => {
    const verdict = checkInvariants(
      "I want to extend my stay.",
      "E-7 체류기간을 연장하고 싶습니다.",
      EN,
      KO,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toContain("status-code:added:E-7");
  });

  it("rejects a translation that adds a consequence the visitor did not state", () => {
    const verdict = checkInvariants(
      "I changed my workplace yesterday.",
      "어제 근무처를 변경했고 신고기한 15일이 이미 지났습니다.",
      EN,
      KO,
    );
    expect(verdict.ok).toBe(false);
  });

  it("keeps HiKorea and the office number intact", () => {
    expect(
      checkInvariants(
        "Book it on HiKorea or call 1345.",
        "하이코리아에서 예약하시거나 1345로 전화하세요.",
        EN,
        KO,
      ).problems,
    ).toEqual([]);
    expect(
      checkInvariants("Call 1345.", "1355로 전화하세요.", EN, KO).ok,
    ).toBe(false);
  });
});
