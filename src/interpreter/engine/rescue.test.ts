import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "@/types";
import {
  RESCUE_MAX_CHARS,
  RESCUE_WINDOW_MS,
  rescueKoreanText,
  selectRescueSegments,
} from "./rescue";

const segment = (id: string, text: string, at: number): TranscriptSegment => ({
  id,
  text,
  at,
});

describe("Rescue transcript window", () => {
  it("keeps only stable Korean from the recent rescue window", () => {
    const segments = [
      segment("old", "이미 오래 전에 지나간 문장", 2_000),
      segment("a", "우리는 다시 복음의 중심으로 돌아가야 합니다", 11_000),
      segment("b", "그리고 그 중심에는 예수 그리스도가 계십니다", 18_500),
    ];

    expect(selectRescueSegments(segments, 20_000).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
    expect(RESCUE_WINDOW_MS).toBe(12_000);
  });

  it("returns nothing rather than reviving stale sermon content", () => {
    const segments = [segment("old", "십자가의 은혜를 기억합시다", 1_000)];
    expect(selectRescueSegments(segments, 20_000)).toEqual([]);
    expect(rescueKoreanText(segments, 20_000)).toBe("");
  });

  it("prioritises the newest resolved idea when the character budget is tight", () => {
    const segments = [
      segment("a", "가".repeat(70), 9_000),
      segment("b", "나".repeat(70), 10_000),
      segment("c", "다".repeat(70), 11_000),
    ];

    const selected = selectRescueSegments(segments, 12_000, { maxChars: 150 });
    expect(selected.map((item) => item.id)).toEqual(["b", "c"]);
    expect(rescueKoreanText(segments, 12_000, { maxChars: 150 })).toContain("다".repeat(20));
  });

  it("clips one oversized latest segment from the front, preserving the resume point", () => {
    const latest = `${"앞".repeat(RESCUE_MAX_CHARS)}마지막핵심`;
    const text = rescueKoreanText([segment("latest", latest, 10_000)], 10_500);
    expect(text.length).toBeLessThanOrEqual(RESCUE_MAX_CHARS);
    expect(text.endsWith("마지막핵심")).toBe(true);
  });
});
