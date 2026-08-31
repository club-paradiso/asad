import { describe, expect, it } from "vitest";
import { buildCounterPrompt } from "./prompt";

describe("multilingual counter prompt", () => {
  it("forces Simplified Chinese for Mainland Chinese target", () => {
    const prompt = buildCounterPrompt({
      text: "여권을 보여 주세요.",
      sourceLang: "ko-KR",
      targetLang: "zh-CN",
      inputMode: "text",
    });
    expect(prompt).toContain("Simplified Chinese");
    expect(prompt).toContain("简体中文");
    expect(prompt).toMatch(/Do not output pinyin/i);
  });

  it("forces Traditional Chinese for Taiwan target", () => {
    const prompt = buildCounterPrompt({
      text: "Please wait here.",
      sourceLang: "en-US",
      targetLang: "zh-TW",
      inputMode: "text",
    });
    expect(prompt).toContain("Traditional Chinese");
    expect(prompt).toContain("繁體中文");
  });

  it("tells the model to clean only harmless ASR artifacts for voice input", () => {
    const prompt = buildCounterPrompt({
      text: "我 要 延 长 签 证",
      sourceLang: "zh-CN",
      targetLang: "ko-KR",
      inputMode: "voice",
    });
    expect(prompt).toMatch(/SOURCE IS SPEECH-TO-TEXT/i);
    expect(prompt).toMatch(/spacing, punctuation, and token-boundary artifacts/i);
    expect(prompt).toMatch(/Do not guess/i);
  });

  it("labels each context turn with its actual language", () => {
    const prompt = buildCounterPrompt({
      text: "네, 여기 있어요.",
      sourceLang: "ko-KR",
      targetLang: "zh-CN",
      recent: [
        { from: "guest", text: "需要护照吗？", lang: "zh-CN" },
        { from: "host", text: "네, 여권이 필요합니다.", lang: "ko-KR" },
      ],
    });
    expect(prompt).toContain("VISITOR [Chinese (Simplified)]");
    expect(prompt).toContain("STAFF [Korean]");
  });
});
