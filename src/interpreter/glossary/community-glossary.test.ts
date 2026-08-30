import { describe, expect, it } from "vitest";
import {
  COMMUNITY_SERMON_GLOSSARY,
  COMMUNITY_SERMON_GLOSSARY_SOURCE_COUNT,
} from "./community-glossary";
import { matchGlossary } from "./matcher";

describe("community sermon glossary", () => {
  it("covers all 447 unique Korean headwords from the 500-row workbook", () => {
    expect(COMMUNITY_SERMON_GLOSSARY_SOURCE_COUNT).toBe(500);
    expect(new Set(COMMUNITY_SERMON_GLOSSARY.map((item) => item.korean)).size).toBe(
      447,
    );
  });

  it("adds volunteer terminology to sermon mode", () => {
    const matches = matchGlossary(
      "성령의 충만 가운데 결단의 시간을 갖겠습니다.",
      "sermon",
    );
    const terms = new Map(matches.map((item) => [item.korean, item.english]));
    expect(terms.get("성령의 충만")).toBe("The Fullness of the Holy Spirit");
    expect(terms.get("결단의 시간")).toBe("Time of Commitment");
  });

  it("does not leak church-specific vocabulary into general mode", () => {
    const matches = matchGlossary("성령의 충만 가운데 결단의 시간", "general");
    expect(matches.map((item) => item.korean)).not.toContain("성령의 충만");
    expect(matches.map((item) => item.korean)).not.toContain("결단의 시간");
  });

  it("keeps the curated theological rendering ahead of the community fallback", () => {
    const match = matchGlossary("그리스도의 대속을 믿습니다.", "sermon").find(
      (item) => item.korean === "대속",
    );
    expect(match?.english).toBe("atonement");
    expect(match?.alternatives).toContain("substitutionary atonement");
  });
});
