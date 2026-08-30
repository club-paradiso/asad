import { describe, expect, it } from "vitest";
import {
  makePrepGlossaryItem,
  removePrepGlossaryItem,
  upsertPrepGlossaryItem,
} from "./SessionGlossaryEditor";

describe("session glossary editing", () => {
  it("normalises a human prep entry and marks it as prep-owned", () => {
    expect(makePrepGlossaryItem("  성령의 충만 ", " Fullness of the Holy Spirit ", "  preferred today  ")).toEqual({
      korean: "성령의 충만",
      english: "Fullness of the Holy Spirit",
      note: "preferred today",
      source: "prep",
    });
  });

  it("requires both Korean and English", () => {
    expect(makePrepGlossaryItem("", "Grace")).toBeNull();
    expect(makePrepGlossaryItem("은혜", "   ")).toBeNull();
  });

  it("puts the human override first and removes duplicate headwords", () => {
    const next = makePrepGlossaryItem("대속", "substitutionary atonement")!;
    const items = upsertPrepGlossaryItem(
      [
        { korean: "은혜", english: "grace", source: "prep" },
        { korean: "대속", english: "atonement", source: "prep" },
      ],
      next,
    );

    expect(items).toEqual([
      { korean: "대속", english: "substitutionary atonement", source: "prep" },
      { korean: "은혜", english: "grace", source: "prep" },
    ]);
  });

  it("removes the old headword when an edited entry is renamed", () => {
    const next = makePrepGlossaryItem("성령 충만", "the fullness of the Holy Spirit")!;
    const items = upsertPrepGlossaryItem(
      [
        { korean: "성령의 충만", english: "the fullness of the Holy Spirit", source: "prep" },
        { korean: "은혜", english: "grace", source: "prep" },
      ],
      next,
      "성령의 충만",
    );

    expect(items.map((item) => item.korean)).toEqual(["성령 충만", "은혜"]);
  });

  it("removes one term without disturbing the rest", () => {
    expect(
      removePrepGlossaryItem(
        [
          { korean: "은혜", english: "grace" },
          { korean: "언약", english: "covenant" },
        ],
        "은혜",
      ),
    ).toEqual([{ korean: "언약", english: "covenant" }]);
  });
});
