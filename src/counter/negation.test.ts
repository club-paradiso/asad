import { describe, expect, it } from "vitest";
import {
  NEGATION_UNCOVERED_LANGUAGES,
  compareNegation,
  hasNegation,
  negationCheckAvailable,
} from "./negation";

describe("negation detection", () => {
  it.each([
    ["en-US", "I did not change my workplace"],
    ["en-US", "I didn't report it"],
    ["en-US", "I cannot come on that date"],
    ["en-US", "I have no residence card"],
    ["ko-KR", "회사를 바꾸지 않았습니다"],
    ["ko-KR", "예약을 못 했어요"],
    ["ko-KR", "외국인등록증이 없습니다"],
    ["ko-KR", "아니요"],
    ["ko-KR", "안 됩니다"],
    ["zh-CN", "我没有换工作"],
    ["ja-JP", "変更していません"],
    ["vi-VN", "Tôi không đổi chỗ làm"],
    ["ru-RU", "Я не менял место работы"],
    ["ar-SA", "لم أغير مكان العمل"],
    ["fr-FR", "Je n'ai pas changé"],
    ["de-DE", "Ich habe nicht gewechselt"],
    ["tr-TR", "İş yerimi değiştirmedim"],
    ["mn-MN", "Би ажлаа сольсонгүй"],
  ])("finds negation in %s: %s", (language, text) => {
    expect(hasNegation(text, language)).toBe(true);
  });

  it.each([
    ["en-US", "I changed my workplace yesterday"],
    ["ko-KR", "회사를 바꿨습니다"],
    ["ko-KR", "안내 데스크로 가세요"],
    ["zh-CN", "我换了工作"],
    ["fr-FR", "J'ai changé de travail"],
  ])("finds no negation in %s: %s", (language, text) => {
    expect(hasNegation(text, language)).toBe(false);
  });

  it("does not fire on 안내, which an immigration desk says all day", () => {
    // 안내 (information/guidance) contains 안. A substring match on 안 would
    // report negation on nearly every Korean turn at a service counter.
    expect(hasNegation("안내문을 확인해 주세요", "ko-KR")).toBe(false);
    expect(hasNegation("안 됩니다", "ko-KR")).toBe(true);
  });

  it("answers null, not false, for a language it cannot check", () => {
    for (const language of NEGATION_UNCOVERED_LANGUAGES) {
      expect(negationCheckAvailable(language)).toBe(false);
      expect(hasNegation("anything at all", language)).toBeNull();
    }
  });
});

describe("negation across a translation", () => {
  it("catches a dropped negation, which is the reversal that matters", () => {
    expect(
      compareNegation(
        "I did not change my workplace",
        "어제 회사를 변경했습니다",
        "en-US",
        "ko-KR",
      ),
    ).toBe("dropped");
  });

  it("catches an invented negation", () => {
    expect(
      compareNegation("I changed my workplace", "회사를 변경하지 않았습니다", "en-US", "ko-KR"),
    ).toBe("added");
  });

  it("passes a faithful translation in both directions", () => {
    expect(
      compareNegation(
        "I did not change my workplace",
        "회사를 변경하지 않았습니다",
        "en-US",
        "ko-KR",
      ),
    ).toBe("preserved");
    expect(
      compareNegation("근무처를 변경했습니다", "I changed my workplace", "ko-KR", "en-US"),
    ).toBe("preserved");
  });

  it("stays silent rather than guessing when either side is uncheckable", () => {
    // A check that fires on every correctly translated Uzbek turn is worse
    // than no check: people stop reading it, and then it fails silently for
    // Korean and English too.
    expect(
      compareNegation("I did not change", "Men ish joyimni o'zgartirmadim", "en-US", "uz-UZ"),
    ).toBe("unknown");
    expect(compareNegation("hech narsa", "nothing", "uz-UZ", "en-US")).toBe("unknown");
  });
});
