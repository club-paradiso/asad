import { describe, expect, it } from "vitest";
import { emptyStabiliser, flushReason, pushStable } from "./stabiliser";
import { lagConfig } from "./lag";

const balanced = lagConfig("balanced");
const at = (text: string) => flushReason(pushStable(emptyStabiliser(), text, 0), balanced, 0);

/**
 * Worship speech has endings ordinary Korean rarely uses, and a closing prayer
 * is the most formulaic speech in a service. Each of these used to wait for
 * silence or the hold ceiling; each is now a sentence boundary on arrival.
 */
describe("sermon and prayer sentence endings", () => {
  it.each([
    "주님, 저희를 긍휼히 여기소서",
    "오늘도 저희 걸음을 인도하여 주옵소서.",
    "주여 이 땅을 고쳐 주시옵소서",
    "예수님의 이름으로 기도드립니다 아멘",
    "하나님 아버지 감사합니다. 아멘.",
  ])("flushes on arrival: %s", (text) => {
    expect(at(text)).toBe("sentence");
  });

  it.each([
    // Open clauses that must keep waiting for their predicate.
    "우리를 시험에 들게 하지 마시옵고",
    "주님께서 우리에게 주신 이 말씀을",
    "그래서 사도 바울은 로마에 있는",
  ])("still holds an unfinished thought: %s", (text) => {
    expect(at(text)).not.toBe("sentence");
  });

  it("does not mistake 아멘 inside a sentence for its end", () => {
    expect(at("아멘이라고 함께 고백하는 것은")).not.toBe("sentence");
  });
});
