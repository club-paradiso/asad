import { describe, expect, it } from "vitest";
import {
  drain,
  emptyStabiliser,
  flushReason,
  pushStable,
  shouldAnticipate,
  splitThoughtUnits,
  touch,
} from "./stabiliser";
import { lagConfig } from "./lag";

const balanced = lagConfig("balanced");
const fast = lagConfig("fast");
const safe = lagConfig("safe");

describe("flush timing", () => {
  it("does not flush an empty buffer", () => {
    expect(flushReason(emptyStabiliser(), balanced, 1000)).toBeNull();
  });

  it("flushes immediately on a completed Korean sentence", () => {
    const state = pushStable(emptyStabiliser(), "우리는 하나님의 부르심을 받은 사람들입니다.", 0);
    expect(flushReason(state, balanced, 0)).toBe("sentence");
  });

  it("holds a fragment that is still too short to be worth a call", () => {
    const state = pushStable(emptyStabiliser(), "그런데", 0);
    expect(flushReason(state, balanced, 100)).toBeNull();
  });

  it("flushes on silence once enough has accumulated", () => {
    const state = pushStable(emptyStabiliser(), "제가 오늘 여러분과 함께 나누고", 0);
    expect(flushReason(state, balanced, 100)).toBeNull();
    expect(flushReason(state, balanced, balanced.stabiliseMs + 1)).toBe("quiet");
  });

  it("flushes on the hold ceiling even for a speaker who never pauses", () => {
    // Short text that would otherwise never reach the trigger length.
    const state = pushStable(emptyStabiliser(), "그런데", 0);
    expect(flushReason(state, balanced, balanced.maxHoldMs + 1)).toBe("timeout");
  });

  it("respects the lag profile: safe waits longer than fast", () => {
    const state = pushStable(emptyStabiliser(), "제가 오늘 여러분과 함께 나누고", 0);
    expect(flushReason(state, fast, fast.stabiliseMs + 1)).toBe("quiet");
    expect(flushReason(state, safe, fast.stabiliseMs + 1)).toBeNull();
  });

  it("counts recogniser activity as not-silence", () => {
    let state = pushStable(emptyStabiliser(), "제가 오늘 여러분과 함께 나누고", 0);
    state = touch(state, 800);
    expect(flushReason(state, balanced, 1000)).toBeNull();
  });
});

describe("draining", () => {
  it("returns the buffer and resets it", () => {
    const state = pushStable(emptyStabiliser(), "안녕하세요.", 0);
    const { text, state: next } = drain(state);
    expect(text).toBe("안녕하세요.");
    expect(next.pending).toBe("");
    expect(next.pendingSince).toBeNull();
  });

  it("joins consecutive stable results", () => {
    let state = pushStable(emptyStabiliser(), "첫 번째 문장입니다.", 0);
    state = pushStable(state, "두 번째 문장입니다.", 100);
    expect(drain(state).text).toBe("첫 번째 문장입니다. 두 번째 문장입니다.");
  });

  it("ignores whitespace-only recognition", () => {
    const state = pushStable(emptyStabiliser(), "   ", 0);
    expect(state.pending).toBe("");
    expect(state.lastEventAt).toBe(0);
  });
});

describe("anticipation gating", () => {
  it("never predicts in SAFE mode", () => {
    expect(shouldAnticipate(safe, "quiet", "그런데 우리가 이 은혜를")).toBe(false);
  });

  it("never predicts after a completed sentence", () => {
    // Predicting past a full stop is where confident invention comes from.
    expect(shouldAnticipate(fast, "sentence", "다음 문장 시작")).toBe(false);
  });

  it("predicts mid-thought when there is unresolved Korean", () => {
    expect(shouldAnticipate(balanced, "quiet", "그런데 우리가 이 은혜를")).toBe(true);
  });

  it("will not predict from nothing", () => {
    expect(shouldAnticipate(fast, "quiet", "")).toBe(false);
    expect(shouldAnticipate(balanced, "quiet", "그런")).toBe(false);
  });
});

describe("thought units", () => {
  it("leaves a short sentence alone", () => {
    expect(splitThoughtUnits("우리는 하나님의 백성입니다.")).toEqual([
      "우리는 하나님의 백성입니다.",
    ]);
  });

  it("splits a long sentence at connective boundaries", () => {
    const units = splitThoughtUnits(
      "베드로 사도는 우리를 가리켜서 택하신 족속이요, 왕 같은 제사장들이요, 거룩한 나라요, 그의 소유가 된 백성이라고 말씀하고 있습니다.",
      40,
    );
    expect(units.length).toBeGreaterThan(1);
    expect(units.join(" ").replace(/\s+/g, "")).toContain("택하신족속이요");
  });

  it("returns nothing for empty input", () => {
    expect(splitThoughtUnits("   ")).toEqual([]);
  });
});
