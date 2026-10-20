import { describe, expect, it } from "vitest";
import { earbudPairProblem, earbudTargetName, EARBUD_OUTPUT_LANGUAGES } from "./language-pairs";

describe("Earbud Mode global language-pair gates", () => {
  it("supports Korean speech translated into English", () => {
    expect(earbudPairProblem("ko-KR", "en-US")).toBeNull();
    expect(earbudTargetName("en-US")).toBe("English");
  });
  it("preserves original foreign speech to Korean", () => {
    expect(earbudPairProblem("en-US", "ko-KR")).toBeNull();
    expect(earbudPairProblem("zh-CN", "ko-KR")).toBeNull();
    expect(earbudPairProblem("vi-VN", "ko-KR")).toBeNull();
  });
  it("allows multilingual sources translating into English", () => {
    expect(earbudPairProblem("ja-JP", "en-US")).toBeNull();
    expect(earbudPairProblem("zh-CN", "en-US")).toBeNull();
  });
  it("refuses same-language and unsupported output", () => {
    expect(earbudPairProblem("ko-KR", "ko-KR")).toBe("same-language");
    expect(earbudPairProblem("en-US", "en-US")).toBe("same-language");
    expect(earbudPairProblem("ko-KR", "zz-ZZ")).toBe("unsupported-output");
    expect(EARBUD_OUTPUT_LANGUAGES).toEqual(["ko-KR", "en-US"]);
  });
});
