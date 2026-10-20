import { describe, expect, it } from "vitest";
import type { BibleReference } from "@/types";
import {
  formatReference,
  isCanonicalFormat,
  normaliseModelReference,
  verifyReferences,
} from "./format";

const ref = (over: Partial<BibleReference> = {}): BibleReference => ({
  book: "1 Peter",
  chapter: 2,
  verse: 9,
  display: "1 Peter 2:9",
  confidence: "high",
  ...over,
});

describe("canonical 장:절 formatting", () => {
  it("formats chapter and verse", () => {
    expect(formatReference(ref())).toBe("1 Peter 2:9");
  });

  it("formats verse ranges", () => {
    expect(formatReference(ref({ book: "Romans", chapter: 5, verse: 1, verseEnd: 3, display: "" }))).toBe(
      "Romans 5:1-3",
    );
  });

  it("formats chapter-only references", () => {
    expect(formatReference(ref({ book: "Psalms", chapter: 23, verse: undefined, display: "" }))).toBe(
      "Psalms 23",
    );
  });

  it("recognises canonical display strings", () => {
    expect(isCanonicalFormat("1 Peter 2:9")).toBe(true);
    expect(isCanonicalFormat("John 3:16")).toBe(true);
    expect(isCanonicalFormat("Romans 5:1-3")).toBe(true);
    expect(isCanonicalFormat("Psalms 23")).toBe(true);
    expect(isCanonicalFormat("요한복음 3장 16절")).toBe(false);
    expect(isCanonicalFormat("somewhere in the Bible")).toBe(false);
    expect(isCanonicalFormat("")).toBe(false);
  });
});

describe("normaliseModelReference", () => {
  it("passes canonical English through", () => {
    expect(normaliseModelReference("1 Peter 2:9")?.display).toBe("1 Peter 2:9");
  });

  it("normalises loose English ranges", () => {
    expect(normaliseModelReference("John 3:16-18")?.display).toBe("John 3:16-18");
  });

  it("normalises Korean spoken forms to 장:절", () => {
    const normalised = normaliseModelReference("요한복음 3장 16절");
    expect(normalised?.display).toBe("John 3:16");
    expect(normalised?.book).toBe("John");
  });

  it("drops what it cannot read confidently", () => {
    expect(normaliseModelReference("어딘가의 말씀")).toBeNull();
    expect(normaliseModelReference("")).toBeNull();
    expect(normaliseModelReference("요한복음 99장 99절")).toBeNull();
  });
});

describe("verifyReferences", () => {
  const trusted = [ref({ book: "John", chapter: 3, verse: 16, display: "John 3:16" })];

  it("verifies references the detector heard", () => {
    const [checked] = verifyReferences(
      [ref({ book: "John", chapter: 3, verse: 16, display: "John 3:16" })],
      trusted,
    );
    expect(checked.verified).toBe(true);
    expect(checked.display).toBe("John 3:16");
  });

  it("flags references the detector never heard", () => {
    const [checked] = verifyReferences(
      [ref({ book: "Romans", chapter: 8, verse: 28, display: "Romans 8:28" })],
      trusted,
    );
    expect(checked.verified).toBe(false);
    // The claim is recorded, not rewritten or dropped.
    expect(checked.display).toBe("Romans 8:28");
  });

  it("normalises non-canonical displays before comparing", () => {
    const [checked] = verifyReferences(
      [ref({ book: "John", chapter: 3, verse: 16, display: "요한복음 3장 16절" })],
      trusted,
    );
    expect(checked.display).toBe("John 3:16");
    expect(checked.verified).toBe(true);
  });
});
