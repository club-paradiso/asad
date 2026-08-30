import { describe, expect, it } from "vitest";
import type { PrepSheet } from "@/types";
import { buildSttHints, STT_HINT_LIMIT } from "./stt-hints";

const prep = (overrides: Partial<PrepSheet> = {}): PrepSheet => ({
  glossary: [],
  entities: [],
  ...overrides,
});

describe("sermon STT hints", () => {
  it("prioritises the speaker, prepared names and explicit glossary", () => {
    const hints = buildSttHints(
      "sermon",
      prep({
        speaker: "류정길",
        entities: [{ korean: "성안교회", english: "Seongan Church", kind: "organisation" }],
        glossary: [{ korean: "공동체적 제자도", english: "communal discipleship", source: "prep" }],
      }),
    );

    expect(hints.slice(0, 3)).toEqual(["류정길", "성안교회", "공동체적 제자도"]);
  });

  it("promotes a volunteer-glossary term when it appears in today's prep", () => {
    const hints = buildSttHints(
      "sermon",
      prep({ notes: "설교 후 성령의 충만 가운데 결단의 시간을 갖겠습니다." }),
    );

    expect(hints).toContain("성령의 충만");
    expect(hints).toContain("결단의 시간");
  });

  it("does not inject sermon theology into general mode", () => {
    const hints = buildSttHints("general", prep());
    expect(hints).not.toContain("대속");
    expect(hints).not.toContain("성화");
  });

  it("deduplicates and never exceeds the provider budget", () => {
    const hints = buildSttHints(
      "sermon",
      prep({
        speaker: "하나님",
        glossary: Array.from({ length: 80 }, (_, index) => ({
          korean: `준비용어${index}`,
          english: `term ${index}`,
          source: "prep" as const,
        })),
      }),
    );

    expect(hints).toHaveLength(STT_HINT_LIMIT);
    expect(hints.filter((hint) => hint === "하나님")).toHaveLength(1);
  });
});
