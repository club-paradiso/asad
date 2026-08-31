import { describe, expect, it } from "vitest";
import { buildCounterPrompt } from "./prompt";

describe("multilingual Counter prompts", () => {
  it("adds conservative Mandarin ASR recovery guidance", () => {
    const prompt = buildCounterPrompt({
      text: "我要延长居留期间",
      sourceLang: "zh-CN",
      targetLang: "ko-KR",
      inputMode: "voice",
      recent: [
        { from: "host", text: "여권 보여 주세요", lang: "ko-KR" },
        { from: "guest", text: "好的", lang: "zh-CN" },
      ],
    });

    expect(prompt).toContain("MANDARIN ASR");
    expect(prompt).toContain("homophone substitutions");
    expect(prompt).toContain("Never silently repair uncertain names");
    expect(prompt).toContain("Korean 존댓말");
  });

  it("keeps typed multilingual chat intentional instead of auto-correcting facts", () => {
    const prompt = buildCounterPrompt({
      text: "D-2 9/7까지 맞죠?",
      sourceLang: "ko-KR",
      targetLang: "zh-CN",
      inputMode: "text",
    });

    expect(prompt).toContain("Treat the text as intentional");
    expect(prompt).toContain("code-switched");
    expect(prompt).toContain("Simplified Chinese");
    expect(prompt).toContain("D-2 9/7까지 맞죠?");
  });

  it("keeps up to six recent turns for short conversational replies", () => {
    const recent = Array.from({ length: 7 }, (_, index) => ({
      from: index % 2 === 0 ? ("host" as const) : ("guest" as const),
      text: `turn-${index + 1}`,
      lang: index % 2 === 0 ? "ko-KR" : "vi-VN",
    }));
    const prompt = buildCounterPrompt({
      text: "네",
      sourceLang: "ko-KR",
      targetLang: "vi-VN",
      inputMode: "text",
      recent,
    });

    expect(prompt).not.toContain("turn-1");
    expect(prompt).toContain("turn-2");
    expect(prompt).toContain("turn-7");
  });
});
