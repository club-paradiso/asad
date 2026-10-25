import { describe, expect, it } from "vitest";
import { extractCriticalValues, validateTranslationIntegrity } from "./integrity";
import { compareNegation, hasNegation } from "./negation";
import { softNumbers } from "./number-words";

/**
 * Faithful translations the integrity check used to reject.
 *
 * Each of these came from a probe of common service-desk renderings. A
 * warning that fires on correct output is not a stricter warning; it is one
 * people learn to ignore, which then costs the real finding its audience.
 */
const KO = "ko-KR";
const EN = "en-US";

describe("faithful renderings that must verify", () => {
  it.each<[string, string, string, string]>([
    ["오후 3시에 오세요.", "Please come at 3 PM.", KO, EN],
    ["오후 3시에 오세요.", "Please come at 3pm.", KO, EN],
    ["오후 3시에 오세요.", "Please come at 3 p.m.", KO, EN],
    ["오전 10시 반에 오세요.", "Please come at 10:30 AM.", KO, EN],
    ["오전 10시 반에 오세요.", "Please come at 10:30 a.m.", KO, EN],
    ["Please come at 3 o'clock.", "3시에 오세요.", EN, KO],
    ["수수료는 50,000원입니다.", "The fee is 50,000 won.", KO, EN],
    ["수수료는 6만원입니다.", "The fee is 60,000 won.", KO, EN],
    ["수수료는 6만 원입니다.", "The fee is ₩60,000.", KO, EN],
    ["수수료는 3만 5천 원입니다.", "The fee is 35,000 won.", KO, EN],
    ["보증금은 100만 원입니다.", "The deposit is 1,000,000 won.", KO, EN],
    ["The fee is 30 dollars.", "수수료는 30달러입니다.", EN, KO],
    ["手数料は5万円です。", "The fee is 50,000 yen.", "ja-JP", EN],
    ["서류 3장을 제출하세요.", "Please submit three documents.", KO, EN],
    ["여권 사본 2부가 필요합니다.", "You need two copies of your passport.", KO, EN],
    ["두 번째 창구로 가세요.", "Please go to counter 2.", KO, EN],
    ["2번 창구로 가세요.", "Please go to the second counter.", KO, EN],
    ["열 시에 오세요.", "Please come at 10.", KO, EN],
    ["3월 15일까지 신청하세요.", "Please apply by the 15th of March.", KO, EN],
    ["2026년 3월 15일에 만료됩니다.", "It expires on the 15th of March, 2026.", KO, EN],
    ["Please bring your Alien Registration Card.", "외국인등록증을 가져오세요.", EN, KO],
    ["Go to the Immigration Office on Monday.", "월요일에 출입국사무소로 가세요.", EN, KO],
    ["Counter No. 2 is closed.", "2번 창구는 닫혔습니다.", EN, KO],
    ["E-7 비자로 변경하시려는 거죠?", "Bạn muốn chuyển sang visa E-7, đúng không?", KO, "vi-VN"],
    ["예약하셨나요?", "Bạn có hẹn không?", KO, "vi-VN"],
    ["예약하셨나요?", "您有预约吗？是不是今天？", KO, "zh-CN"],
    ["실례합니다, 여권을 보여주시겠어요?", "不好意思，请出示您的护照。", KO, "zh-CN"],
    ["무료입니다.", "無料です。", KO, "ja-JP"],
    ["Hai bản sao.", "사본 2부.", "vi-VN", KO],
    ["Две копии.", "2부.", "ru-RU", KO],
    ["Dos copias.", "2부.", "es-ES", KO],
    // Vietnamese giờ is hours as often as o'clock; only a clock marker makes it a time.
    ["3시간 기다려 주세요.", "Vui lòng đợi 3 giờ.", KO, "vi-VN"],
    ["Vui lòng đợi 3 giờ.", "Please wait 3 hours.", "vi-VN", EN],
    ["Hẹn lúc 3 giờ chiều.", "오후 3시 예약입니다.", "vi-VN", KO],
    ["오후 3시에 오세요.", "Hãy đến lúc 3 giờ chiều.", KO, "vi-VN"],
    // Compound numerals are whole values.
    ["서류 22장을 제출하세요.", "Please submit twenty-two documents.", KO, EN],
    ["서류 12장을 제출하세요.", "请提交十二份文件。", KO, "zh-CN"],
    ["Please submit 22 documents.", "서류 스물두 장을 제출하세요.", EN, KO],
  ])("%s → %s", (source, target, sourceLang, targetLang) => {
    const result = validateTranslationIntegrity(source, target, sourceLang, targetLang);
    expect(result.issues, JSON.stringify(result.issues)).toEqual([]);
    expect(result.status).toBe("verified");
  });
});

describe("corruptions that must still be caught", () => {
  it("still catches a changed amount written with a Korean scale", () => {
    const result = validateTranslationIntegrity("수수료는 6만 원입니다.", "The fee is 6,000 won.", KO, EN);
    expect(result.status).toBe("mismatch");
    expect(result.issues[0]).toMatchObject({ kind: "money", reason: "changed" });
  });

  it("still catches a changed meridiem", () => {
    const result = validateTranslationIntegrity("오후 3시에 오세요.", "Please come at 3 AM.", KO, EN);
    expect(result.status).toBe("mismatch");
    expect(result.issues[0]).toMatchObject({ kind: "time", reason: "changed" });
  });

  it("still catches a quantity written as the wrong word", () => {
    const result = validateTranslationIntegrity("서류 3장을 제출하세요.", "Please submit two documents.", KO, EN);
    expect(result.status).toBe("mismatch");
    expect(result.issues[0]).toMatchObject({ kind: "integer", reason: "missing", sourceText: "3" });
  });

  it("does not let a compound numeral's parts excuse a wrong quantity", () => {
    // "twenty-two" used to read as a 20 and a 2, and the 2 satisfied 2장.
    for (const [target, targetLang] of [
      ["Please submit twenty-two documents.", EN],
      ["请提交十二份文件。", "zh-CN"],
    ] as const) {
      const result = validateTranslationIntegrity("서류 2장을 제출하세요.", target, KO, targetLang);
      expect(result.issues, target).toContainEqual(
        expect.objectContaining({ kind: "integer", reason: "missing", sourceText: "2" }),
      );
    }
    expect(
      validateTranslationIntegrity("Please submit 2 documents.", "서류 스물두 장을 제출하세요.", EN, KO).status,
    ).toBe("mismatch");
  });

  it("never lets a number word raise an issue on its own", () => {
    // "One moment, please" for 잠시만요 is not an invented quantity.
    expect(validateTranslationIntegrity("잠시만 기다려 주세요.", "One moment, please.", KO, EN).status).toBe(
      "verified",
    );
    // And a real invented digit is still reported.
    expect(
      validateTranslationIntegrity("잠시만 기다려 주세요.", "One moment, please — counter 7.", KO, EN).issues,
    ).toContainEqual(expect.objectContaining({ kind: "integer", reason: "added", targetText: "7" }));
  });

  it("still catches an invented status code and a dropped negation", () => {
    expect(
      validateTranslationIntegrity(
        "체류기간이 30일 남았습니다.",
        "You have 30 days left on your period of stay (D-2).",
        KO,
        EN,
      ).issues,
    ).toContainEqual(expect.objectContaining({ kind: "status-code", reason: "added" }));
    expect(
      compareNegation("Tôi chưa báo cáo việc đổi chỗ làm.", "저는 근무처 변경을 신고했습니다.", "vi-VN", KO),
    ).toBe("dropped");
  });

  it("keeps the person-name check for a Latin name that vanished", () => {
    const result = validateTranslationIntegrity("My name is Kim Min Su.", "제 이름은 김민수입니다.", EN, KO);
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: "name", reason: "missing" }));
  });
});

describe("extraction details", () => {
  it("reads Korean scaled amounts as one value", () => {
    expect(extractCriticalValues("3만 5천 원", KO)).toEqual([
      expect.objectContaining({ kind: "money", normalized: "KRW:35000" }),
    ]);
    expect(extractCriticalValues("2천만 원", KO)).toEqual([
      expect.objectContaining({ kind: "money", normalized: "KRW:20000000" }),
    ]);
    // A count after the amount is a separate value, not part of the sum.
    expect(extractCriticalValues("3만 2장", KO).map((v) => v.normalized)).toEqual(["30000", "2"]);
  });

  it("reads 12-hour times", () => {
    expect(extractCriticalValues("at 12 PM", EN)[0]).toMatchObject({ kind: "time", normalized: "12:00" });
    expect(extractCriticalValues("at 12 AM", EN)[0]).toMatchObject({ kind: "time", normalized: "00:00" });
    expect(extractCriticalValues("at 3:15 pm", EN)[0]).toMatchObject({ kind: "time", normalized: "15:15" });
  });

  it("reads number words only in context", () => {
    expect(softNumbers("two copies and two photos", EN)).toEqual([2, 2]);
    expect(softNumbers("the second counter", EN)).toEqual([2]);
    expect(softNumbers("세 명이 왔어요", KO)).toEqual([3]);
    expect(softNumbers("열 시에 오세요", KO)).toEqual([10]);
    // 세 in 오세요, 네 as "yes", 한 in 한국: not numbers.
    expect(softNumbers("네, 한국에 오세요", KO)).toEqual([]);
    expect(softNumbers("一起去", "zh-CN")).toEqual([]);
    expect(softNumbers("两份", "zh-CN")).toEqual([2]);
    expect(softNumbers("二十三份", "zh-CN")).toEqual([23]);
    expect(softNumbers("twenty-two and three", EN)).toEqual([22, 3]);
    expect(softNumbers("스물두 장, 세 명, 스무 장", KO)).toEqual([22, 3, 20]);
  });
});

describe("negation exclusions", () => {
  it.each<[string, string]>([
    ["vi-VN", "Bạn có hẹn không?"],
    ["vi-VN", "Đúng không?"],
    ["zh-CN", "是不是今天？"],
    ["zh-CN", "不好意思"],
    ["ja-JP", "無料です"],
    ["ja-JP", "一緒に来ませんか"],
    ["en-US", "Counter No. 2"],
    ["th-TH", "เดือนมิถุนายน"],
  ])("%s: %s is not a negation", (language, text) => {
    expect(hasNegation(text, language)).toBe(false);
  });

  it.each<[string, string]>([
    ["vi-VN", "Tôi không có hẹn."],
    ["vi-VN", "Tôi chưa nộp."],
    ["zh-CN", "我没有预约"],
    ["ja-JP", "予約していません"],
    ["ja-JP", "できません"],
    ["en-US", "No, I did not."],
  ])("%s: %s is still a negation", (language, text) => {
    expect(hasNegation(text, language)).toBe(true);
  });
});
