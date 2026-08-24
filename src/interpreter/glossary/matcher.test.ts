import { describe, expect, it } from "vitest";
import { liveGlossary, matchGlossary, mergeGlossary } from "./matcher";
import { findWholeWordOccurrences, endsWord } from "./match-korean";

describe("Korean whole-word matching", () => {
  it("accepts a noun followed by a particle", () => {
    expect(findWholeWordOccurrences("부르심을 받은", "부르심")).toEqual([0]);
    expect(findWholeWordOccurrences("하나님의 나라", "하나님")).toEqual([0]);
    expect(findWholeWordOccurrences("말씀은 베드로전서", "말씀")).toEqual([0]);
  });

  it("rejects a term that is only part of a longer word", () => {
    // The bug this exists to prevent: 감사합니다 is "thank you", not "thanksgiving".
    expect(findWholeWordOccurrences("함께해 주셔서 감사합니다", "감사")).toEqual([]);
    // 한 must not fire inside 거룩한.
    expect(findWholeWordOccurrences("거룩한 나라요", "한")).toEqual([]);
    expect(findWholeWordOccurrences("정말 좋았습니다", "정")).toEqual([]);
  });

  it("accepts a term at the very end of a segment", () => {
    expect(endsWord("우리의 믿음", 6)).toBe(true);
    expect(findWholeWordOccurrences("우리의 믿음", "믿음")).toEqual([4]);
  });

  it("accepts honorific and plural suffixes", () => {
    expect(findWholeWordOccurrences("성도들이 모였습니다", "성도")).toEqual([0]);
  });
});

describe("glossary matching", () => {
  it("finds theological terms in sermon mode", () => {
    const matches = matchGlossary("우리는 하나님의 부르심을 받은 사람들입니다.", "sermon");
    const terms = matches.map((m) => m.korean);
    expect(terms).toContain("부르심");
    expect(terms).toContain("하나님");
  });

  it("prefers the longest term and suppresses nested ones", () => {
    const matches = matchGlossary("우리는 하나님 나라의 백성입니다.", "sermon");
    const terms = matches.map((m) => m.korean);
    expect(terms).toContain("하나님 나라");
    expect(terms).not.toContain("하나님");
  });

  it("applies no theological vocabulary in general mode", () => {
    const matches = matchGlossary("우리는 하나님의 부르심을 받았습니다.", "general");
    expect(matches.map((m) => m.korean)).not.toContain("부르심");
  });

  it("orders the live rail by recency and keeps it short", () => {
    const text =
      "은혜 그리고 구원 그리고 회개 그리고 언약 그리고 성령 그리고 복음 그리고 믿음 그리고 소망";
    const live = liveGlossary(text, "sermon");
    expect(live.length).toBeLessThanOrEqual(6);
    // Most recent first.
    expect(live[0].korean).toBe("소망");
  });

  it("keeps discourse markers off the live rail", () => {
    const live = liveGlossary("여러분, 사실은 그러니까 은혜입니다", "sermon");
    expect(live.map((item) => item.korean)).not.toContain("여러분");
    expect(live.map((item) => item.korean)).toContain("은혜");
  });

  it("lets a prep decision outrank the built-in lexicon", () => {
    const matches = matchGlossary("은혜가 넘칩니다", "sermon", [
      { korean: "은혜", english: "favour", source: "prep" },
    ]);
    expect(matches.find((m) => m.korean === "은혜")?.english).toBe("favour");
  });
});

describe("glossary merging", () => {
  it("never lets a later entry overwrite a prep decision", () => {
    const merged = mergeGlossary(
      [{ korean: "은혜", english: "favour", source: "prep" }],
      [{ korean: "은혜", english: "grace", source: "live" }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].english).toBe("favour");
  });

  it("fills in missing detail on a non-prep entry", () => {
    const merged = mergeGlossary(
      [{ korean: "대속", english: "atonement", source: "lexicon" }],
      [{ korean: "대속", english: "substitutionary atonement", note: "substitution is the point" }],
    );
    expect(merged[0].english).toBe("substitutionary atonement");
    expect(merged[0].note).toBe("substitution is the point");
  });

  it("appends genuinely new terms", () => {
    const merged = mergeGlossary(
      [{ korean: "은혜", english: "grace" }],
      [{ korean: "구원", english: "salvation" }],
    );
    expect(merged).toHaveLength(2);
  });
});
