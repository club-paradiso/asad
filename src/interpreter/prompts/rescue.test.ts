import { describe, expect, it } from "vitest";
import type { InterpretRequest } from "@/lib/schema";
import { buildRescueUserPrompt } from "./rescue";

const context = (overrides: Partial<InterpretRequest["context"]> = {}): InterpretRequest["context"] => ({
  recentKorean: [],
  recentEnglish: [],
  glossary: [],
  entities: [],
  scripture: [],
  corrections: [],
  ...overrides,
});

describe("Rescue prompt", () => {
  it("asks for a resume bridge, not a translation of the whole recent window", () => {
    const prompt = buildRescueUserPrompt({
      mode: "sermon",
      recentKorean:
        "우리는 지난주에 믿음에 대해 살펴봤습니다. 오늘은 소망에 대해 말씀드리겠습니다. 우리의 소망은 예수 그리스도 안에 있습니다.",
      context: context({ recentEnglish: ["Last week we looked at faith."] }),
    });

    expect(prompt).toMatch(/resume speaking NOW/i);
    expect(prompt).toMatch(/do NOT summarise the whole window/i);
    expect(prompt).toMatch(/normally 1 safeChunk; at most 2/i);
    expect(prompt).toMatch(/NO anticipatedChunks/i);
    expect(prompt).toContain("Last week we looked at faith.");
    expect(prompt).toContain("우리의 소망은 예수 그리스도 안에 있습니다");
  });

  it("keeps sermon-specific theological and Scripture safety rules", () => {
    const prompt = buildRescueUserPrompt({
      mode: "sermon",
      recentKorean: "베드로전서 2장 9절 말씀처럼 우리는 택하신 족속입니다.",
      context: context(),
    });

    expect(prompt).toMatch(/theological precision/i);
    expect(prompt).toMatch(/never recite verse wording/i);
    expect(prompt).toMatch(/do NOT invent missing names, numbers, quotations or Scripture wording/i);
  });

  it("returns an empty prompt when there is no current Korean to rescue", () => {
    expect(
      buildRescueUserPrompt({ mode: "sermon", recentKorean: "   ", context: context() }),
    ).toBe("");
  });
});
