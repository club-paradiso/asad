/**
 * What the engine tells the model about its own cut.
 *
 * `buildLiveUserPrompt` used to receive a piece of Korean with no indication of
 * whether it was a finished thought or a thought the clock interrupted — even
 * though the stabiliser had just decided exactly that. These assert the two
 * halves that were missing: the boundary steer, and discourse markers reaching
 * the model instead of being filtered out with the rail's noise.
 */
import { describe, expect, it } from "vitest";
import { buildLiveUserPrompt } from "./live";
import { promptGlossary, liveGlossary } from "@/interpreter/glossary/matcher";
import type { InterpretRequest } from "@/lib/schema";

const request = (over: Partial<InterpretRequest> = {}): InterpretRequest => ({
  mode: "sermon",
  lag: "balanced",
  pending: "우리가 살면서 겪는 모든 일을 우리는 다",
  continuesPrevious: false,
  allowAnticipation: true,
  context: {
    recentKorean: [],
    recentEnglish: [],
    glossary: [],
    entities: [],
    scripture: [],
    corrections: [],
  },
  ...over,
});

describe("boundary steer", () => {
  it("says the thought is closed when the speaker finished it", () => {
    const prompt = buildLiveUserPrompt(request({ boundary: "sentence" }));
    expect(prompt).toContain("CLOSED END");
    expect(prompt).not.toContain("OPEN END");
    expect(prompt).not.toContain("CONTINUATION");
  });

  it("says the thought is open when the clock ended the unit", () => {
    const prompt = buildLiveUserPrompt(request({ boundary: "timeout" }));
    expect(prompt).toContain("OPEN END");
    expect(prompt).toContain("the clock ended it, not the speaker");
    expect(prompt).not.toContain("CLOSED END");
  });

  it("tells the model to carry on rather than restart", () => {
    const prompt = buildLiveUserPrompt(
      request({ boundary: "sentence", continuesPrevious: true }),
    );
    expect(prompt).toContain("CONTINUATION");
    expect(prompt).toContain("do not restart the sentence");
    // The previous unit was open; this one closed it. Both facts are stated.
    expect(prompt).toContain("CLOSED END");
  });

  it("says nothing when the engine supplied no boundary", () => {
    const prompt = buildLiveUserPrompt(request());
    expect(prompt).not.toContain("OPEN END");
    expect(prompt).not.toContain("CLOSED END");
    expect(prompt).not.toContain("CONTINUATION");
  });
});

describe("discourse markers", () => {
  const KOREAN = "결론적으로 말씀드리면 우리는 은혜로 구원을 받았습니다";

  it("reach the model", () => {
    const matched = promptGlossary(KOREAN, "sermon");
    expect(matched.some((g) => g.korean === "결론적으로")).toBe(true);
  });

  it("stay off the interpreter's rail", () => {
    const railed = liveGlossary(KOREAN, "sermon");
    expect(railed.some((g) => g.korean === "결론적으로")).toBe(false);
  });

  it("are presented as the rhetorical move, not as a translation", () => {
    const prompt = buildLiveUserPrompt(
      request({
        pending: KOREAN,
        boundary: "sentence",
        detected: {
          scripture: [],
          glossary: promptGlossary(KOREAN, "sermon"),
          culturalNotes: [],
        },
      }),
    );
    expect(prompt).toContain("Discourse markers present");
    expect(prompt).toContain("결론적으로");
    // Terminology and discourse markers are separate blocks: 은혜 is a term,
    // and listing it among the markers would defeat the whole distinction.
    expect(prompt).toContain("Terms present in this segment");
    const from = prompt.indexOf("Discourse markers present");
    const end = prompt.indexOf("\n\n", from);
    const markerBlock = prompt.slice(from, end === -1 ? undefined : end);
    expect(markerBlock).not.toContain("은혜");
  });
});
