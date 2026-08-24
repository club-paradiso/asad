import { describe, expect, it } from "vitest";
import { sessionFilename, serialiseSession, toJson, toMarkdown, toPlainText } from "./export";
import type { StoredSession } from "@/types";

const session: StoredSession = {
  id: "s1",
  startedAt: Date.UTC(2026, 7, 24, 10, 0, 0),
  endedAt: Date.UTC(2026, 7, 24, 10, 45, 0),
  mode: "sermon",
  title: "Our Identity in Christ",
  speaker: "류정길",
  segments: [
    { id: "seg1", text: "우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.", at: 5000 },
    { id: "seg2", text: "류정길 목사입니다.", at: 65000, corrected: true, originalText: "유정길 목사입니다." },
  ],
  chunks: [
    { id: "c1", text: "Today we're going to look at...", state: "committed", confidence: "high", at: 5200 },
    { id: "c2", text: "1 Peter 2:9.", state: "committed", confidence: "high", at: 6000 },
    {
      id: "c3",
      text: 'And speaking of "the way," it\'s even in my name.',
      state: "committed",
      confidence: "high",
      at: 70000,
      adapted: true,
      note: "Wordplay adapted | not literal",
    },
  ],
  scripture: [{ book: "1 Peter", chapter: 2, verse: 9, display: "1 Peter 2:9", confidence: "high" }],
  glossary: [{ korean: "부르심", english: "calling", note: "the call of God" }],
  culturalNotes: [
    { kind: "wordplay", korean: "길", note: '"Gil" means "way"', suggestion: "even in my name" },
  ],
  entities: [{ korean: "류정길", english: "Ryu Jeong-gil", kind: "person" }],
  corrections: [{ from: "유정길", to: "류정길", at: 65000, english: "Ryu Jeong-gil" }],
};

describe("plain text export", () => {
  const text = toPlainText(session);

  it("carries both languages with timestamps", () => {
    expect(text).toContain("[00:05] 우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.");
    expect(text).toContain("[00:05] Today we're going to look at...");
  });

  it("carries the context the session accumulated", () => {
    expect(text).toContain("1 Peter 2:9");
    expect(text).toContain("부르심 → calling");
    expect(text).toContain("유정길 → 류정길");
  });

  it("marks adapted and low-confidence lines", () => {
    expect(text).toContain("(adapted)");
  });

  it("reports the duration", () => {
    expect(text).toContain("Duration: 45:00");
  });
});

describe("markdown export", () => {
  const markdown = toMarkdown(session);

  it("is a real document, not a text dump", () => {
    expect(markdown).toContain("# Our Identity in Christ");
    expect(markdown).toContain("## Interpreter English");
    expect(markdown).toContain("## Korean transcript");
  });

  it("escapes pipes so a note cannot break the table", () => {
    // The note contains a literal pipe.
    expect(markdown).toContain("Wordplay adapted \\| not literal");
  });

  it("includes the cultural suggestion", () => {
    expect(markdown).toContain("even in my name");
  });
});

describe("json export", () => {
  it("round-trips losslessly", () => {
    expect(JSON.parse(toJson(session))).toEqual(session);
  });
});

describe("filenames", () => {
  it("is sortable, descriptive and safe", () => {
    expect(sessionFilename(session, "markdown")).toBe(
      "tong-yuck-2026-08-24-10-00-our-identity-in-christ.md",
    );
  });

  it("copes with no title", () => {
    const untitled = { ...session, title: undefined };
    expect(sessionFilename(untitled, "json")).toMatch(/^tong-yuck-.*-session\.json$/);
  });
});

describe("format dispatch", () => {
  it("returns each format", () => {
    expect(serialiseSession(session, "txt")).toBe(toPlainText(session));
    expect(serialiseSession(session, "markdown")).toBe(toMarkdown(session));
    expect(serialiseSession(session, "json")).toBe(toJson(session));
  });
});

describe("what is never exported", () => {
  it("contains no audio and no raw recogniser payload", () => {
    const everything = [toPlainText(session), toMarkdown(session), toJson(session)].join("\n");
    expect(everything).not.toMatch(/audio|base64|pcm16|blob:/i);
  });
});
