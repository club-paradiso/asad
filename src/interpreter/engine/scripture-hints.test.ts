/**
 * Scripture hints crossing from the Bible provider into the model prompt.
 *
 * `SERMON_DELTA` permits verse wording only when "the verse text was supplied
 * to you". Nothing ever supplied it: the request was built from a fresh local
 * detection pass, which carries a reference and never its text. So a verse that
 * ASAD had resolved and was already showing on the context rail was still
 * off-limits to the model, and the hint vanished entirely as soon as the
 * preacher stopped repeating the reference and started reading the passage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InterpretRequest } from "@/lib/schema";
import type { BibleReference } from "@/types";
import { emptyPrepSheet } from "@/types";
import { InterpretationEngine, __resetSegmentIds } from "./session";
import { __resetChunkIds } from "./chunks";
import { buildLiveUserPrompt } from "@/interpreter/prompts/live";

const ANNOUNCEMENT = "우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.";
const READING = "너희는 택하신 족속이요 왕 같은 제사장들이라고 말씀하십니다.";
const VERSE = "But you are a chosen race, a royal priesthood, a holy nation.";

function harness() {
  __resetChunkIds();
  __resetSegmentIds();

  let now = 0;
  const requests: InterpretRequest[] = [];

  const engine = new InterpretationEngine({
    mode: "sermon",
    lag: "balanced",
    prep: emptyPrepSheet(),
    now: () => now,
    onChange: () => {},
    interpret: async (request) => {
      requests.push(request);
      return { output: { safeChunks: [{ text: "ok", confidence: "high" }], confidence: "high" } };
    },
    resolveBible: async (reference: BibleReference) => ({
      ...reference,
      text: VERSE,
      translation: "WEB",
    }),
  });

  engine.start();

  const say = async (korean: string) => {
    engine.handleStable(korean);
    now += 3000;
    engine.tick();
    await vi.waitFor(() => expect(engine.snapshot().thinking).toBe(false));
  };

  return { engine, say, requests };
}

beforeEach(() => {
  __resetChunkIds();
  __resetSegmentIds();
});

describe("scripture hints", () => {
  it("hands the model the verse text it resolved, not just the reference", async () => {
    const h = harness();
    await h.say(ANNOUNCEMENT);
    await vi.waitFor(() =>
      expect(h.engine.snapshot().scripture.find((r) => r.display === "1 Peter 2:9")?.text).toBe(
        VERSE,
      ),
    );

    await h.say(READING);

    const hinted = h.requests.at(-1)!.detected!.scripture;
    expect(hinted.map((r) => r.display)).toContain("1 Peter 2:9");
    expect(hinted.find((r) => r.display === "1 Peter 2:9")?.text).toBe(VERSE);
  });

  it("renders the supplied text into the user turn so the model may use it", async () => {
    const h = harness();
    await h.say(ANNOUNCEMENT);
    await vi.waitFor(() =>
      expect(h.engine.snapshot().scripture.some((r) => r.text)).toBe(true),
    );
    await h.say(READING);

    const prompt = buildLiveUserPrompt(h.requests.at(-1)!);
    expect(prompt).toContain("1 Peter 2:9");
    expect(prompt).toContain(VERSE);
    expect(prompt).toContain("text (WEB)");
  });

  it("sends no verse text when no Bible provider resolved one", async () => {
    __resetChunkIds();
    __resetSegmentIds();
    let now = 0;
    const requests: InterpretRequest[] = [];
    const engine = new InterpretationEngine({
      mode: "sermon",
      lag: "balanced",
      prep: emptyPrepSheet(),
      now: () => now,
      onChange: () => {},
      interpret: async (request) => {
        requests.push(request);
        return { output: { safeChunks: [{ text: "ok", confidence: "high" }], confidence: "high" } };
      },
    });
    engine.start();
    engine.handleStable(ANNOUNCEMENT);
    now += 3000;
    engine.tick();
    await vi.waitFor(() => expect(engine.snapshot().thinking).toBe(false));

    const hinted = requests.at(-1)!.detected!.scripture;
    expect(hinted.map((r) => r.display)).toContain("1 Peter 2:9");
    expect(hinted.every((r) => r.text === undefined)).toBe(true);
    expect(buildLiveUserPrompt(requests.at(-1)!)).not.toContain("text (");
  });
});
