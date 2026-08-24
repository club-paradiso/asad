import { describe, expect, it } from "vitest";
import { detectScriptureReferences, parseEnglishReference } from "./detect";
import { parseSinoNumeral, parseNumberToken } from "./numerals";

describe("Sino-Korean numerals", () => {
  it("reads single digits and units", () => {
    expect(parseSinoNumeral("구")).toBe(9);
    expect(parseSinoNumeral("십")).toBe(10);
    expect(parseSinoNumeral("이십삼")).toBe(23);
    expect(parseSinoNumeral("백오십")).toBe(150);
    expect(parseSinoNumeral("백")).toBe(100);
  });

  it("rejects non-numerals rather than guessing", () => {
    expect(parseSinoNumeral("사랑")).toBeNull();
    expect(parseSinoNumeral("")).toBeNull();
  });

  it("reads digits and numerals through one entry point", () => {
    expect(parseNumberToken("9")).toBe(9);
    expect(parseNumberToken("구")).toBe(9);
    expect(parseNumberToken("나라")).toBeNull();
  });
});

describe("spoken Korean Scripture references", () => {
  it("normalises the acceptance case", () => {
    const [ref] = detectScriptureReferences(
      "우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.",
    );
    expect(ref.display).toBe("1 Peter 2:9");
    expect(ref.book).toBe("1 Peter");
    expect(ref.chapter).toBe(2);
    expect(ref.verse).toBe(9);
    expect(ref.confidence).toBe("high");
    expect(ref.koreanRaw).toContain("베드로전서");
  });

  it("handles the other worked examples", () => {
    expect(detectScriptureReferences("로마서 5장 8절")[0].display).toBe("Romans 5:8");
    expect(detectScriptureReferences("요한복음 3장 16절")[0].display).toBe("John 3:16");
  });

  it("reads 편 for Psalms and colon form", () => {
    expect(detectScriptureReferences("시편 23편 1절")[0].display).toBe("Psalms 23:1");
    expect(detectScriptureReferences("요한복음 3:16")[0].display).toBe("John 3:16");
  });

  it("reads verse ranges", () => {
    const [ref] = detectScriptureReferences("베드로전서 2장 9절부터 10절까지");
    expect(ref.display).toBe("1 Peter 2:9-10");
    expect(ref.verseEnd).toBe(10);
  });

  it("reads spelled-out numbers", () => {
    expect(detectScriptureReferences("베드로전서 이장 구절")[0].display).toBe("1 Peter 2:9");
  });

  it("rejects chapters the book does not have", () => {
    // Jude has one chapter; "유다서 5장" is a recognition error, not a reference.
    expect(detectScriptureReferences("유다서 5장 2절")).toHaveLength(0);
  });

  it("does not invent references from ordinary speech", () => {
    expect(detectScriptureReferences("우리는 하나님의 부르심을 받은 사람들입니다.")).toHaveLength(0);
    expect(detectScriptureReferences("아가 좀 봐 주세요")).toHaveLength(0);
    expect(detectScriptureReferences("오늘은 3장 정도 읽었어요")).toHaveLength(0);
  });

  it("marks an abbreviation as less confident than a full name", () => {
    const full = detectScriptureReferences("베드로전서 2장 9절")[0];
    const abbreviated = detectScriptureReferences("벧전 2장 9절")[0];
    expect(full.confidence).toBe("high");
    expect(abbreviated.confidence).toBe("medium");
  });

  it("prefers the longest book name", () => {
    // 요한복음 must beat the bare 요 abbreviation.
    expect(detectScriptureReferences("요한복음 1장 1절")[0].book).toBe("John");
    // 예레미야애가 must beat 예레미야.
    expect(detectScriptureReferences("예레미야애가 3장 22절")[0].book).toBe("Lamentations");
  });

  it("de-duplicates repeated references", () => {
    expect(
      detectScriptureReferences("베드로전서 2장 9절, 다시 한번 베드로전서 2장 9절"),
    ).toHaveLength(1);
  });
});

describe("English references typed into the prep sheet", () => {
  it("parses the common forms", () => {
    expect(parseEnglishReference("1 Peter 2:9")?.display).toBe("1 Peter 2:9");
    expect(parseEnglishReference("Romans 5")?.display).toBe("Romans 5");
    expect(parseEnglishReference("John 3:16-17")?.display).toBe("John 3:16-17");
  });

  it("returns null rather than guessing", () => {
    expect(parseEnglishReference("Hezekiah 4:2")).toBeNull();
    expect(parseEnglishReference("nonsense")).toBeNull();
    expect(parseEnglishReference("Jude 5:1")).toBeNull();
  });
});
