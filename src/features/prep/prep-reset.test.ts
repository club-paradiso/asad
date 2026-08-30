import { describe, expect, it } from "vitest";
import { freshPrepSheet, hasPrepContent } from "./prep-reset";

describe("Prep reset", () => {
  it("recognises an actually empty Prep sheet", () => {
    expect(hasPrepContent({ glossary: [], entities: [] })).toBe(false);
  });

  it("treats any session context as content that can leak into the next service", () => {
    expect(
      hasPrepContent({
        speaker: "류정길",
        glossary: [],
        entities: [],
      }),
    ).toBe(true);
    expect(
      hasPrepContent({
        glossary: [{ korean: "은혜", english: "grace", source: "prep" }],
        entities: [],
      }),
    ).toBe(true);
  });

  it("returns a genuinely empty sheet without touching any other store", () => {
    expect(freshPrepSheet()).toEqual({ glossary: [], entities: [] });
  });
});
