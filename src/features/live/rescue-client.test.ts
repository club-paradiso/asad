import { describe, expect, it } from "vitest";
import { emptyPrepSheet } from "@/types";
import type { EngineSnapshot } from "@/interpreter/engine/session";
import { buildRescueRequest, parseRescueResponse } from "./rescue-client";

const snapshot = (overrides: Partial<EngineSnapshot> = {}): EngineSnapshot => ({
  segments: [],
  partial: null,
  chunks: [],
  scripture: [],
  glossary: [],
  culturalNotes: [],
  entities: [],
  corrections: [],
  connection: "live",
  health: { stt: "ok", llm: "ok", bible: "ok" },
  thinking: false,
  ...overrides,
});

describe("Rescue client", () => {
  it("builds a bounded side request from recent stable Korean", () => {
    const request = buildRescueRequest({
      snapshot: snapshot({
        segments: [
          { id: "s1", text: "오래된 도입부", at: 1_000 },
          { id: "s2", text: "우리는 은혜로 구원을 받습니다", at: 9_000 },
          { id: "s3", text: "그러므로 두려워하지 마십시오", at: 15_000 },
        ],
        chunks: [
          {
            id: "c1",
            text: "We are saved by grace.",
            state: "committed",
            confidence: "high",
            at: 10_000,
          },
          {
            id: "c2",
            text: "Maybe he will say something next.",
            state: "anticipated",
            confidence: "low",
            at: 15_500,
          },
        ],
        glossary: [{ korean: "은혜", english: "grace", source: "lexicon" }],
        topic: "Grace",
      }),
      mode: "sermon",
      prep: emptyPrepSheet(),
      elapsedMs: 16_000,
    });

    expect(request).not.toBeNull();
    expect(request?.recentKorean).toBe(
      "우리는 은혜로 구원을 받습니다 그러므로 두려워하지 마십시오",
    );
    expect(request?.context.recentEnglish).toContain("We are saved by grace.");
    expect(request?.context.recentEnglish).not.toContain(
      "Maybe he will say something next.",
    );
    expect(request?.context.glossary).toEqual([
      { korean: "은혜", english: "grace", source: "lexicon" },
    ]);
  });

  it("returns null instead of resurrecting stale Korean after a long pause", () => {
    const request = buildRescueRequest({
      snapshot: snapshot({
        segments: [{ id: "s1", text: "이미 오래전에 끝난 문장", at: 1_000 }],
      }),
      mode: "sermon",
      prep: emptyPrepSheet(),
      elapsedMs: 30_000,
    });

    expect(request).toBeNull();
  });

  it("carries resolved session memory into the rolling Rescue context", () => {
    const request = buildRescueRequest({
      snapshot: snapshot({
        segments: [{ id: "s1", text: "류정길 목사님이 대속을 설명합니다", at: 10_000 }],
        scripture: [
          {
            book: "1 Peter",
            chapter: 2,
            verse: 9,
            display: "1 Peter 2:9",
            confidence: "high",
          },
        ],
        entities: [
          { korean: "류정길", english: "Ryu Jeong-gil", kind: "person", note: "user" },
        ],
        corrections: [
          { from: "유정길", to: "류정길", english: "Ryu Jeong-gil", at: 5_000 },
        ],
        glossary: [{ korean: "대속", english: "atonement", source: "lexicon" }],
      }),
      mode: "sermon",
      prep: emptyPrepSheet(),
      elapsedMs: 11_000,
    });

    expect(request?.context.entities[0]?.english).toBe("Ryu Jeong-gil");
    expect(request?.context.corrections[0]).toMatchObject({
      from: "유정길",
      to: "류정길",
      english: "Ryu Jeong-gil",
    });
    expect(request?.context.scripture).toContain("1 Peter 2:9");
    expect(request?.context.glossary[0]?.english).toBe("atonement");
  });

  it("validates server output before exposing a recovery cue", () => {
    const parsed = parseRescueResponse({
      output: {
        safeChunks: [{ text: "So do not be afraid.", confidence: "high" }],
        anticipatedChunks: [],
        confidence: "high",
      },
      provider: "openrouter",
      model: "example/model",
      latencyMs: 420,
    });

    expect(parsed?.output.safeChunks[0]?.text).toBe("So do not be afraid.");
    expect(parsed?.provider).toBe("openrouter");
    expect(parseRescueResponse({ output: { safeChunks: [{ nope: true }] } })).toBeNull();
    expect(parseRescueResponse(null)).toBeNull();
  });
});
