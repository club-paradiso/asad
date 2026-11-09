import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSemanticIntegrity, semanticCheckAvailable } from "./semantic";
import { assessTranslation, semanticChecksEnabled } from "./assess";

const checks = (source: string, target: string, sl = "ko-KR", tl = "en-US") =>
  checkSemanticIntegrity(source, target, sl, tl).issues.map((issue) => `${issue.severity}:${issue.check}`);

describe("semantic integrity — modality", () => {
  it("catches must → may as critical", () => {
    expect(checks("체류기간 만료 전에 신청하셔야 합니다.", "You may apply before your stay expires.")).toContain(
      "critical:obligation-to-permission",
    );
  });

  it("catches may → must as critical", () => {
    expect(checks("온라인으로 신청하셔도 됩니다.", "You must apply online.")).toContain("critical:permission-to-obligation");
  });

  it("catches cannot → can as critical", () => {
    expect(checks("오늘은 접수할 수 없습니다.", "We can accept it today.", "ko-KR", "en-US")).toContain(
      "critical:prohibition-to-permission",
    );
  });

  it("does not read 'can't' as permission or 'may be' as permission", () => {
    expect(checks("오늘은 안 됩니다.", "We can't do it today.")).toEqual([]);
    expect(checks("아마 다음 주에 나올 거예요.", "It may be ready next week.")).not.toContain(
      "critical:permission-to-obligation",
    );
  });

  it("accepts faithful obligations across languages", () => {
    expect(checks("여권을 반드시 가져오셔야 합니다.", "Bạn phải mang theo hộ chiếu.", "ko-KR", "vi-VN")).toEqual([]);
    expect(checks("여권을 반드시 가져오셔야 합니다.", "您必须带护照。", "ko-KR", "zh-CN")).toEqual([]);
    expect(checks("여권을 반드시 가져오셔야 합니다.", "Anda harus membawa paspor.", "ko-KR", "id-ID")).toEqual([]);
    expect(checks("여권을 반드시 가져오셔야 합니다.", "Вы должны принести паспорт.", "ko-KR", "ru-RU")).toEqual([]);
    expect(checks("여권을 반드시 가져오셔야 합니다.", "คุณต้องนำหนังสือเดินทางมา", "ko-KR", "th-TH")).toEqual([]);
  });
});

describe("semantic integrity — procedure concepts", () => {
  it("catches application → approval as critical", () => {
    expect(checks("신청은 접수되었습니다.", "Your application has been approved.")).toEqual(
      expect.arrayContaining(["critical:concept-substituted"]),
    );
  });

  it("catches residence status → residence card", () => {
    expect(checks("체류자격을 확인해 주세요.", "Please check your residence card.")).toContain("critical:concept-substituted");
  });

  it("catches report → permission", () => {
    expect(checks("근무처를 바꾸면 신고하셔야 합니다.", "If you change your workplace, you must get approval.")).toContain(
      "critical:concept-substituted",
    );
  });

  it("catches departure deadline → stay expiry, and departure order → deportation", () => {
    expect(checks("출국기한은 10월 15일입니다.", "Your period of stay expires on October 15.")).toContain(
      "critical:concept-substituted",
    );
    expect(checks("출국명령을 받으셨습니다.", "You have been given a deportation order.")).toContain(
      "critical:concept-substituted",
    );
  });

  it("catches refugee recognition → humanitarian stay", () => {
    expect(checks("난민인정을 받으셨습니다.", "You received a humanitarian stay permit.")).toContain(
      "critical:concept-substituted",
    );
  });

  it("flags 'accepted' for 접수 as a mistranslation-prone term", () => {
    expect(checks("서류가 접수되었습니다.", "Your documents were accepted.")).toContain("high:mistranslation-prone-term");
  });

  it("does not flag 'accepted' when no procedure is being discussed", () => {
    expect(checks("수수료는 카드로 내실 수 있습니다.", "Card payment is accepted for the fee.")).not.toContain(
      "high:mistranslation-prone-term",
    );
  });

  it("flags an invented approval", () => {
    expect(checks("서류 확인했습니다.", "Your extension has been approved.")).toContain("high:invented-concept");
  });
});

describe("semantic integrity — conditions, completion, certainty, actor", () => {
  it("catches a dropped condition", () => {
    expect(checks("만료 전에 예약을 못 하시면 직접 방문하세요.", "Please visit in person before your stay expires.")).toContain(
      "high:condition-dropped",
    );
  });

  it("catches pending → completed", () => {
    expect(checks("아직 심사 중입니다.", "It has already been completed.")).toContain("critical:pending-to-completed");
  });

  it("catches unjustified certainty", () => {
    expect(checks("아마 다음 주에 나올 거예요.", "It will be ready next week.")).toContain("high:unjustified-certainty");
  });

  it("catches an actor swap", () => {
    expect(checks("저희가 연락드리겠습니다.", "You need to call the office.")).toContain("high:actor-changed");
  });

  it("does not flag actor when both parties appear", () => {
    expect(checks("저희가 연락드리겠습니다.", "We will contact you.")).toEqual([]);
  });
});

describe("semantic integrity — coverage is explicit", () => {
  it("returns unsupported for a pair without a lexicon, never a silent pass", () => {
    const result = checkSemanticIntegrity("필요합니다", "Kerak", "ko-KR", "uz-UZ");
    expect(result.status).toBe("unsupported");
    expect(result.unchecked.length).toBeGreaterThan(0);
    expect(semanticCheckAvailable("uz-UZ")).toBe(false);
    expect(semanticCheckAvailable("zh-TW")).toBe(true);
  });

  it("reports the actor check as unchecked where no actor lexicon exists", () => {
    const result = checkSemanticIntegrity("필요합니다", "Cần thiết", "ko-KR", "vi-VN");
    expect(result.status).toBe("partial");
    expect(result.unchecked).toEqual(["actor"]);
  });
});

describe("assessTranslation — one verdict", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("blocks a critical meaning change even when every value matches", () => {
    const result = assessTranslation("5월 3일까지 신청하셔야 합니다.", "You may apply by May 3.", "ko-KR", "en-US");
    expect(result.issues).toEqual([]);
    expect(result.status).toBe("mismatch");
    expect(result.assessment).toBe("blocked");
  });

  it("blocks a structured value mismatch", () => {
    const result = assessTranslation("5월 3일까지 신청하셔야 합니다.", "You must apply by May 8.", "ko-KR", "en-US");
    expect(result.assessment).toBe("blocked");
  });

  it("passes a faithful translation and calls it passed, not verified by a person", () => {
    const result = assessTranslation("5월 3일까지 신청하셔야 합니다.", "You must apply by May 3.", "ko-KR", "en-US");
    expect(result.status).toBe("verified");
    expect(result.assessment).toBe("passed");
  });

  it("is unverified, not passed, when the language has no semantic lexicon", () => {
    const result = assessTranslation("신청하셔야 합니다.", "Ariza topshirishingiz kerak.", "ko-KR", "uz-UZ");
    expect(result.assessment).toBe("unverified");
  });

  it("can be switched off by environment without losing the value checks", () => {
    vi.stubEnv("COUNTER_SEMANTIC_CHECKS", "off");
    expect(semanticChecksEnabled()).toBe(false);
    const result = assessTranslation("5월 3일", "May 8", "ko-KR", "en-US", { semantic: semanticChecksEnabled() });
    expect(result.semantic).toBeUndefined();
    expect(result.assessment).toBe("blocked");
  });
});
