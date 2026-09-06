/**
 * Segmentation quality — where the engine cuts the Korean.
 *
 * The rest of the suite tests the stabiliser's MECHANICS: that a trigger fires,
 * that a buffer drains, that SAFE waits longer than FAST. None of it tests the
 * only thing that matters to the interpretation — whether the cut lands at a
 * place a thought actually ends.
 *
 * That gap is why a mid-phrase cut could ship unnoticed. A unit ending one word
 * before its predicate is not a latency problem, it is a WRONG ANSWER problem:
 * the model is handed a subject with no verb and either invents the payload or
 * emits a scaffold the interpreter has to talk over when the real predicate
 * lands two seconds later.
 *
 * So these are fixtures, not unit tests. Each is a piece of sermon Korean at a
 * moment the recogniser could plausibly stabilise it, and each says whether
 * that moment is a thought boundary.
 */
import { describe, expect, it } from "vitest";
import { flushReason, emptyStabiliser, pushStable } from "./stabiliser";
import { lagConfig } from "./lag";

const BALANCED = lagConfig("balanced");

/** The reason at the instant the text stabilises — no silence, no waiting. */
const at = (text: string) => {
  const now = 10_000;
  const state = pushStable(emptyStabiliser(), text, now);
  return flushReason(state, BALANCED, now);
};

describe("a completed thought is cut", () => {
  const COMPLETE = [
    "우리는 하나님의 부르심을 받은 사람들입니다",
    "오늘 우리가 함께 살펴볼 말씀은 베드로전서 2장 9절입니다",
    "이것이 바로 우리가 붙들어야 할 약속이지요",
    "그 사랑이 얼마나 큰지 우리가 다 알 수 있을까",
    "형제자매 여러분, 함께 기도하십시오",
    "지금부터 조용히 눈을 감으세요",
    "그때 제 마음이 얼마나 뜨거웠는지 모릅니다",
  ];

  for (const korean of COMPLETE) {
    it(`"${korean}"`, () => {
      expect(at(korean)).toBe("sentence");
    });
  }
});

describe("an open thought is not cut", () => {
  /**
   * Every one of these ends on a syllable that IS a sentence ending elsewhere,
   * and every one of them is mid-phrase. The predicate is still coming.
   */
  const OPEN = [
    // 다 as the adverb "all", not the declarative ending.
    "우리가 살면서 겪는 모든 일을 우리는 다",
    "오늘 이 자리에 모인 성도 여러분이 다",
    // 네 as "yes" / a counter, not the ending.
    "제가 지난주에 만난 그 청년이 하는 말이 글쎄 네",
    // 요 as a standalone particle rather than the polite ending.
    "제가 오늘 나누고 싶은 말씀은 다름 아니라 요",
  ];

  for (const korean of OPEN) {
    it(`"${korean}"`, () => {
      expect(at(korean)).not.toBe("sentence");
    });
  }

  it("still cuts when the recogniser supplied real punctuation", () => {
    // The speaker did stop; the recogniser heard it. Believe the full stop.
    expect(at("우리가 살면서 겪는 모든 일을 우리는 다.")).toBe("sentence");
  });
});

describe("nothing is cut before it is worth a call", () => {
  it("holds a complete but tiny utterance", () => {
    expect(at("아멘입니다")).toBeNull();
  });
});
