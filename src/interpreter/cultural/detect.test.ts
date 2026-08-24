import { describe, expect, it } from "vitest";
import {
  containsBareNoun,
  detectCultural,
  detectIdioms,
  detectNamePuns,
} from "./detect";
import type { EntityResolution } from "@/types";

const RYU: EntityResolution = {
  korean: "류정길",
  english: "Ryu Jeong-gil",
  kind: "person",
  note: "Speaker",
};

describe("bare-noun detection", () => {
  it("finds a noun carrying a particle", () => {
    expect(containsBareNoun("길을 잘 찾아야 됩니다", "길")).toBe(true);
    expect(containsBareNoun("제 이름에도 길이 있어요", "길")).toBe(true);
  });

  it("does not fire inside a longer word", () => {
    expect(containsBareNoun("거룩한 나라요", "한")).toBe(false);
    expect(containsBareNoun("감사합니다", "감사")).toBe(false);
  });
});

describe("name wordplay — the acceptance case", () => {
  const line = "그래서 우리는 길을 잘 찾아야 됩니다. 제 이름에도 길이 있어요.";

  it("detects the pun when the speaker points at their own name", () => {
    const notes = detectNamePuns(line, [RYU]);
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe("wordplay");
    expect(notes[0].korean).toBe("길");
  });

  it("explains it in one line the interpreter can absorb at a glance", () => {
    const [note] = detectNamePuns(line, [RYU]);
    expect(note.note).toContain("Ryu Jeong-gil");
    expect(note.note).toContain("way");
    expect(note.note.length).toBeLessThan(120);
  });

  it("supplies a sayable adaptation, not a literal rendering", () => {
    const [note] = detectNamePuns(line, [RYU]);
    expect(note.suggestion).toBeTruthy();
    expect(note.suggestion?.toLowerCase()).toContain("way");
    // The explicit quality failure from the brief.
    expect(note.suggestion?.toLowerCase()).not.toContain("road in my name");
  });

  it("warns more softly when the pun has not been made yet", () => {
    const notes = detectNamePuns("우리는 길을 찾아야 합니다.", [RYU]);
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toContain("may be coming");
    // No suggestion, because there is no pun to adapt yet.
    expect(notes[0].suggestion).toBeUndefined();
  });

  it("stays quiet when the speaker's name shares nothing with the text", () => {
    const other: EntityResolution = { korean: "김서연", english: "Kim Seo-yeon", kind: "person" };
    expect(detectNamePuns("길을 잘 찾아야 됩니다.", [other])).toHaveLength(0);
  });

  it("stays quiet with no known speaker", () => {
    expect(detectNamePuns("길을 잘 찾아야 됩니다.", [])).toHaveLength(0);
  });

  it("puts wordplay first — it is the one you cannot recover from", () => {
    const notes = detectCultural(`${line} 티끌 모아 태산이라고 하지 않습니까?`, [RYU]);
    expect(notes[0].kind).toBe("wordplay");
  });
});

describe("idioms and untranslatables", () => {
  it("gives a sayable English equivalent for a proverb", () => {
    const [note] = detectIdioms("티끌 모아 태산이라고 하지 않습니까?");
    expect(note.kind).toBe("idiom");
    expect(note.suggestion).toBe("Little by little, it adds up.");
  });

  it("handles the dynamic-equivalence blessing", () => {
    const [note] = detectIdioms("오늘 하루도 은혜 많이 받으세요.");
    expect(note.suggestion).toBe("I hope you're richly blessed today.");
    expect(note.suggestion).not.toContain("Receive much grace");
  });

  it("does not fire a short entry on a substring", () => {
    // 한 must not be found inside 거룩한 나라.
    const notes = detectIdioms("여러분은 거룩한 나라입니다.");
    expect(notes.map((n) => n.korean)).not.toContain("한");
  });

  it("keeps the list short enough to read", () => {
    const notes = detectCultural(
      "티끌 모아 태산 시작이 반이다 고생 끝에 낙이 온다 하늘의 별 따기 식은 죽 먹기",
    );
    expect(notes.length).toBeLessThanOrEqual(4);
  });

  it("returns nothing for ordinary speech", () => {
    expect(detectCultural("오늘 날씨가 참 좋습니다.")).toHaveLength(0);
  });
});
