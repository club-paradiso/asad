import { describe, expect, it } from "vitest";
import type { InterpretationChunk } from "@/types";
import { unspokenCommitted } from "./speakable";

const chunk = (id: string, overrides: Partial<InterpretationChunk> = {}): InterpretationChunk => ({
  id, text: "체류기간 연장 신청입니다.", state: "committed",
  confidence: "high", at: 1, ...overrides,
});

describe("earbud speech safety", () => {
  it("speaks only final, stable, confident translations", () => {
    const result = unspokenCommitted([
      chunk("confirmed"),
      chunk("prediction", { state: "anticipated" }),
      chunk("editable", { state: "current" }),
      chunk("provisional", { provisional: true }),
      chunk("uncertain", { confidence: "low" }),
      chunk("revision", { correctsChunkId: "confirmed" }),
      chunk("blank", { text: "  " }),
    ], new Set());
    expect(result.map((value) => value.id)).toEqual(["confirmed"]);
  });

  it("never repeats an already voiced chunk", () => {
    expect(unspokenCommitted([chunk("a"), chunk("b")], new Set(["a"])).map((x) => x.id))
      .toEqual(["b"]);
  });

  it("cannot speak a speculative refinement if the same id was previously seen", () => {
    expect(unspokenCommitted([chunk("a", { text: "changed" })], new Set(["a"]))).toEqual([]);
  });
});
