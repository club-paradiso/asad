import { describe, expect, it } from "vitest";
import {
  joinBrowserResultParts,
  joinTranscriptParts,
  pickSpeechAlternative,
} from "./transcript";

describe("multilingual transcript cleanup", () => {
  it("prefers native-script Chinese over a Latin phonetic alternative", () => {
    expect(
      pickSpeechAlternative(["wo yao ban qian zheng", "我要办签证", "我要办签正"], "zh-CN"),
    ).toBe("我要办签证");
  });

  it("breaks Chinese ties toward the selected Simplified or Traditional locale", () => {
    const choices = ["我要辦簽證", "我要办签证"];
    expect(pickSpeechAlternative(choices, "zh-CN")).toBe("我要办签证");
    expect(pickSpeechAlternative([...choices].reverse(), "zh-TW")).toBe("我要辦簽證");
  });

  it("prefers the expected script for Arabic, Russian and Hindi", () => {
    expect(pickSpeechAlternative(["pasport", "паспорт"], "ru-RU")).toBe("паспорт");
    expect(pickSpeechAlternative(["jawaz safar", "جواز سفر"], "ar-SA")).toBe("جواز سفر");
    expect(pickSpeechAlternative(["passport", "पासपोर्ट"], "hi-IN")).toBe("पासपोर्ट");
  });

  it("keeps the browser's first choice when the language has no script heuristic", () => {
    expect(pickSpeechAlternative(["visa extension", "visa extensions"], "en-US")).toBe(
      "visa extension",
    );
  });

  it("does not inject spaces between Chinese, Japanese or Thai recognition chunks", () => {
    expect(joinTranscriptParts(["我要", "延长", "签证"], "zh-CN")).toBe("我要延长签证");
    expect(joinTranscriptParts(["在留期間を", "延長したいです"], "ja-JP")).toBe(
      "在留期間を延長したいです",
    );
    expect(joinTranscriptParts(["ขอต่อ", "วีซ่า"], "th-TH")).toBe("ขอต่อวีซ่า");
  });

  it("preserves Korean browser result-slot joining without removing stable phrase spaces", () => {
    expect(joinBrowserResultParts(["안녕", "하세요"], "ko-KR")).toBe("안녕하세요");
    expect(joinTranscriptParts(["여권을", "보여 주세요"], "ko-KR")).toBe("여권을 보여 주세요");
  });

  it("keeps spaces for languages that use them and removes punctuation gaps", () => {
    expect(joinTranscriptParts(["I need", "a visa", " ."], "en-US")).toBe("I need a visa.");
    expect(joinTranscriptParts(["Мне нужен", "паспорт"], "ru-RU")).toBe("Мне нужен паспорт");
  });
});
