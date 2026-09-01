import { describe, expect, it } from "vitest";
import { detectCounterProfile } from "./profile-detection";

describe("automatic counter profile detection", () => {
  it("uses the desk label as context without asking during setup", () => {
    expect(
      detectCounterProfile({ text: "예약하셨나요?", deskLabel: "호텔 프런트" }),
    ).toBe("hotel");
  });

  it("infers ordinary service vocabulary from the conversation", () => {
    expect(detectCounterProfile({ text: "체류기간 연장을 신청하려고 합니다." })).toBe(
      "immigration",
    );
    expect(detectCounterProfile({ text: "처방전을 가지고 수납 창구로 가세요." })).toBe(
      "hospital",
    );
  });

  it("detects sensitive contexts locally before model routing", () => {
    expect(detectCounterProfile({ text: "난민인정 면접 일정이 언제인가요?" })).toBe(
      "refugee",
    );
    expect(detectCounterProfile({ text: "This is a criminal investigation." })).toBe(
      "judicial",
    );
  });

  it("keeps sensitive routing sticky through ambiguous follow-up turns", () => {
    expect(
      detectCounterProfile({ text: "네", currentProfileId: "refugee" }),
    ).toBe("refugee");
  });

  it("keeps the current context when no stronger signal appears", () => {
    expect(
      detectCounterProfile({ text: "잠시만 기다려 주세요.", currentProfileId: "tourism" }),
    ).toBe("tourism");
  });
});
