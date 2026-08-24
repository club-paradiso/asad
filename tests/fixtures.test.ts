/**
 * Runs every evaluation fixture through the local detection and interpretation
 * path, asserting the properties each case exists to protect.
 */
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./fixtures";
import { detectScriptureReferences } from "@/interpreter/scripture/detect";
import { matchGlossary } from "@/interpreter/glossary/matcher";
import { detectCultural } from "@/interpreter/cultural/detect";
import { interpretLocally } from "@/providers/llm/mock";
import { SERMON_DEMO } from "@/demo/sermon-script";
import { romaniseName } from "@/lib/romanise";

const SPEAKER = [
  { korean: SERMON_DEMO.speaker, english: SERMON_DEMO.speakerRomanised, kind: "person" as const },
];

describe("evaluation fixtures", () => {
  it("covers every interpretation category the brief names", () => {
    const categories = new Set(FIXTURES.map((f) => f.category));
    expect(categories.size).toBeGreaterThanOrEqual(15);
  });

  for (const fixture of FIXTURES) {
    describe(`${fixture.id} · ${fixture.category}`, () => {
      const output = interpretLocally({
        pending: fixture.korean,
        mode: "sermon",
        scriptId: SERMON_DEMO.id,
      });
      const english = output.safeChunks.map((chunk) => chunk.text).join(" ");

      if (fixture.expect.scripture) {
        it("detects the Scripture reference", () => {
          const found = detectScriptureReferences(fixture.korean).map((r) => r.display);
          for (const reference of fixture.expect.scripture!) expect(found).toContain(reference);
        });
      }

      if (fixture.expect.terms) {
        it("offers the terminology", () => {
          const found = matchGlossary(fixture.korean, "sermon").map((m) => m.korean);
          for (const term of fixture.expect.terms!) expect(found).toContain(term);
        });
      }

      if (fixture.expect.cultural) {
        it("surfaces the cultural note", () => {
          // Notes reach the console from two places — the local detector and
          // the interpretation output — and the fixture cares that the
          // interpreter sees one, not which half produced it.
          const kinds = [
            ...detectCultural(fixture.korean, SPEAKER),
            ...(output.culturalNotes ?? []),
          ].map((note) => note.kind);
          for (const kind of fixture.expect.cultural!) expect(kinds).toContain(kind);
        });
      }

      if (fixture.expect.required) {
        it("produces the required English", () => {
          for (const text of fixture.expect.required!) {
            expect(english.toLowerCase()).toContain(text.toLowerCase());
          }
        });
      }

      if (fixture.expect.forbidden) {
        it("never produces the forbidden rendering", () => {
          for (const text of fixture.expect.forbidden!) {
            expect(english.toLowerCase()).not.toContain(text.toLowerCase());
          }
        });
      }

      if (fixture.expect.quiet) {
        it("stays quiet on ordinary speech", () => {
          expect(detectScriptureReferences(fixture.korean)).toHaveLength(0);
          expect(detectCultural(fixture.korean, SPEAKER)).toHaveLength(0);
        });
      }
    });
  }
});

describe("romanisation", () => {
  it("uses the convention interpreters read off a screen", () => {
    expect(romaniseName("류정길")).toBe("Ryu Jeong-gil");
    expect(romaniseName("김서연")).toBe("Kim Seo-yeon");
    expect(romaniseName("이순신")).toBe("Lee Sun-sin");
  });

  it("handles two-syllable surnames", () => {
    expect(romaniseName("남궁민수")).toBe("Namgung Min-su");
  });

  it("prefers the conventional surname spelling over strict RR", () => {
    // Strict Revised Romanisation gives Gim / Bak / Choe, which no Korean
    // person writes and no interpreter should say.
    expect(romaniseName("김민수").startsWith("Kim")).toBe(true);
    expect(romaniseName("박지성").startsWith("Park")).toBe(true);
    expect(romaniseName("최현우").startsWith("Choi")).toBe(true);
  });

  it("passes non-Hangul through untouched", () => {
    expect(romaniseName("John Smith")).toBe("John Smith");
    expect(romaniseName("")).toBe("");
  });
});
