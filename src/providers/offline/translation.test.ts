import { describe, expect, it } from "vitest";
import { prepareLocalTranslation } from "./translation";
import { isKoEn } from "./runtime";

describe("on-device Korean translation output", () => {
  it("rejects empty, echoed and Korean-only output", () => {
    const turn = prepareLocalTranslation("오늘은 회의가 없습니다.");
    expect(turn.accepts("")).toBe(false);
    expect(turn.accepts("오늘은 회의가 없습니다.")).toBe(false);
    expect(turn.accepts("회의가 없습니다.")).toBe(false);
    expect(turn.accepts("There is no meeting today.")).toBe(true);
  });

  it("checks explicitly written won amounts without treating Korean words as amounts", () => {
    const turn = prepareLocalTranslation("총 15,000원을 냈습니다.");
    expect(turn.text).toBe("총 15000 한국 원을 냈습니다.");
    expect(turn.accepts("I paid a total of $15.00.")).toBe(false);
    expect(turn.accepts("I paid 15,000 Korean won.")).toBe(true);
    expect(turn.accepts("I paid KRW 15000.")).toBe(true);
    expect(prepareLocalTranslation("3원칙을 설명합니다.").text).toBe("3원칙을 설명합니다.");
  });

  it("only opts into the tested language direction", () => {
    expect(isKoEn("ko-KR", "en-GB")).toBe(true);
    expect(isKoEn("ja-JP", "en-US")).toBe(false);
    expect(isKoEn("en-US", "ko-KR")).toBe(false);
  });
});
