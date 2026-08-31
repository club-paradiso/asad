import { describe, expect, it } from "vitest";
import { COUNTER_LANGUAGES } from "@/counter/languages";
import { sessionEndCopy } from "./session-end-copy";

describe("Counter session end copy", () => {
  it("has an understandable end action and terminal message for every offered language", () => {
    for (const language of COUNTER_LANGUAGES) {
      const copy = sessionEndCopy(language.code);
      expect(copy.endAction.trim().length, language.code).toBeGreaterThan(2);
      expect(copy.endedTitle.trim().length, language.code).toBeGreaterThan(2);
      expect(copy.endedDetail.trim().length, language.code).toBeGreaterThan(8);
    }
  });

  it("falls back to English for an unknown language", () => {
    expect(sessionEndCopy("xx-XX").endAction).toBe("End conversation");
  });
});
