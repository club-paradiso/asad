import { describe, expect, it } from "vitest";
import { RESCUE_MAX_CHARS } from "@/interpreter/engine/rescue";
import { rescueRequestSchema } from "./rescue-schema";

const base = {
  mode: "sermon" as const,
  recentKorean: "우리의 소망은 예수 그리스도 안에 있습니다.",
  context: {
    recentKorean: [],
    recentEnglish: [],
    glossary: [],
    entities: [],
    scripture: [],
    corrections: [],
  },
};

describe("Rescue request schema", () => {
  it("accepts one bounded recent Korean window with normal live context", () => {
    expect(rescueRequestSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an empty rescue and an oversized window", () => {
    expect(
      rescueRequestSchema.safeParse({ ...base, recentKorean: "   " }).success,
    ).toBe(false);
    expect(
      rescueRequestSchema.safeParse({
        ...base,
        recentKorean: "가".repeat(RESCUE_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
  });
});
