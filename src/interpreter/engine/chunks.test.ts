import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetChunkIds,
  activeChunk,
  addSafeChunks,
  appendCorrection,
  clearAnticipated,
  commitAll,
  commitDueChunks,
  setAnticipatedChunks,
  trimChunks,
  MAX_CHUNKS_IN_VIEW,
} from "./chunks";
import type { InterpretationChunk } from "@/types";

const draft = (text: string) => ({ text, confidence: "high" as const });

beforeEach(() => __resetChunkIds());

describe("temporal locking", () => {
  it("adds confirmed English as editable, not locked", () => {
    const { chunks } = addSafeChunks([], [draft("Today we're going to look at...")], 0);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].state).toBe("current");
  });

  it("locks a chunk once the lag profile's dwell has elapsed", () => {
    const { chunks } = addSafeChunks([], [draft("God has called us.")], 0);
    expect(commitDueChunks(chunks, 1000, 2600)[0].state).toBe("current");
    expect(commitDueChunks(chunks, 2600, 2600)[0].state).toBe("committed");
  });

  it("never rewrites a locked chunk when new English arrives", () => {
    const first = addSafeChunks([], [draft("You are a chosen people.")], 0).chunks;
    const locked = commitAll(first);
    const second = addSafeChunks(locked, [draft("You are a royal priesthood.")], 1000).chunks;

    expect(second).toHaveLength(2);
    expect(second[0].text).toBe("You are a chosen people.");
    expect(second[0].state).toBe("committed");
    // Same object identity: the locked chunk was not touched at all.
    expect(second[0]).toBe(locked[0]);
  });

  it("appends a correction rather than editing what was already said", () => {
    const first = commitAll(addSafeChunks([], [draft("Three thousand people.")], 0).chunks);
    const corrected = appendCorrection(first, first[0].id, "Sorry — three hundred.", 4000);

    expect(corrected).toHaveLength(2);
    expect(corrected[0].text).toBe("Three thousand people.");
    expect(corrected[1].correctsChunkId).toBe(first[0].id);
    expect(corrected[1].note).toBe("correction");
  });

  it("ignores a correction aimed at a chunk that does not exist", () => {
    const chunks = addSafeChunks([], [draft("Hello.")], 0).chunks;
    expect(appendCorrection(chunks, "nope", "fix", 100)).toBe(chunks);
  });
});

describe("anticipated chunks", () => {
  it("keeps predictions out of the confirmed stream", () => {
    const base = addSafeChunks([], [draft("Today, I'd like to talk about...")], 0).chunks;
    const withPrediction = setAnticipatedChunks(base, [draft("our identity in Christ.")], 100);

    expect(withPrediction).toHaveLength(2);
    expect(withPrediction[1].state).toBe("anticipated");
  });

  it("replaces the whole prediction rather than accumulating guesses", () => {
    let chunks = addSafeChunks([], [draft("So...")], 0).chunks;
    chunks = setAnticipatedChunks(chunks, [draft("guess one")], 10);
    chunks = setAnticipatedChunks(chunks, [draft("guess two")], 20);

    const predicted = chunks.filter((c) => c.state === "anticipated");
    expect(predicted).toHaveLength(1);
    expect(predicted[0].text).toBe("guess two");
  });

  it("drops a prediction the moment real English supersedes it", () => {
    let chunks = addSafeChunks([], [draft("So...")], 0).chunks;
    chunks = setAnticipatedChunks(chunks, [draft("we forget who we are.")], 10);
    chunks = addSafeChunks(chunks, [draft("we forget who we are.")], 20).chunks;

    expect(chunks.filter((c) => c.state === "anticipated")).toHaveLength(0);
    expect(chunks).toHaveLength(2);
  });

  it("does not predict something already said", () => {
    const base = addSafeChunks([], [draft("You are a holy nation.")], 0).chunks;
    const chunks = setAnticipatedChunks(base, [draft("You are a holy nation.")], 10);
    expect(chunks.filter((c) => c.state === "anticipated")).toHaveLength(0);
  });

  it("clears predictions without touching confirmed text", () => {
    let chunks = addSafeChunks([], [draft("Confirmed.")], 0).chunks;
    chunks = setAnticipatedChunks(chunks, [draft("Guessed.")], 10);
    expect(clearAnticipated(chunks)).toHaveLength(1);
  });
});

describe("duplicate suppression", () => {
  it("drops a line the model repeats", () => {
    let chunks = addSafeChunks([], [draft("God has called us.")], 0).chunks;
    chunks = addSafeChunks(chunks, [draft("God has called us.")], 500).chunks;
    expect(chunks).toHaveLength(1);
  });

  it("treats punctuation and case differences as the same line", () => {
    let chunks = addSafeChunks([], [draft("God has called us.")], 0).chunks;
    chunks = addSafeChunks(chunks, [draft("god has called us")], 500).chunks;
    expect(chunks).toHaveLength(1);
  });

  it("still allows an intentional refrain to repeat later", () => {
    let chunks = addSafeChunks([], [draft("You are chosen.")], 0).chunks;
    for (let i = 0; i < 7; i += 1) {
      chunks = addSafeChunks(chunks, [draft(`Filler line ${i}.`)], 100 * i).chunks;
    }
    chunks = addSafeChunks(chunks, [draft("You are chosen.")], 5000).chunks;
    expect(chunks.filter((c) => c.text === "You are chosen.")).toHaveLength(2);
  });

  it("ignores blank drafts", () => {
    expect(addSafeChunks([], [draft("   "), draft("")], 0).chunks).toHaveLength(0);
  });
});

describe("active chunk", () => {
  it("is the newest editable line", () => {
    let chunks = addSafeChunks([], [draft("first")], 0).chunks;
    chunks = commitAll(chunks);
    chunks = addSafeChunks(chunks, [draft("second")], 100).chunks;
    expect(activeChunk(chunks)?.text).toBe("second");
  });

  it("falls back to the last locked line when nothing is editable", () => {
    const chunks = commitAll(addSafeChunks([], [draft("only")], 0).chunks);
    expect(activeChunk(chunks)?.text).toBe("only");
  });

  it("never points at a prediction", () => {
    let chunks = addSafeChunks([], [draft("real")], 0).chunks;
    chunks = commitAll(chunks);
    chunks = setAnticipatedChunks(chunks, [draft("guess")], 10);
    expect(activeChunk(chunks)?.text).toBe("real");
  });
});

describe("long sessions", () => {
  it("caps how much is kept in view", () => {
    const many: InterpretationChunk[] = Array.from({ length: MAX_CHUNKS_IN_VIEW + 50 }, (_, i) => ({
      id: `c${i}`,
      text: `line ${i}`,
      state: "committed",
      confidence: "high",
      at: i,
    }));
    const trimmed = trimChunks(many);
    expect(trimmed).toHaveLength(MAX_CHUNKS_IN_VIEW);
    // The oldest are dropped, not the newest.
    expect(trimmed[trimmed.length - 1].text).toBe(`line ${MAX_CHUNKS_IN_VIEW + 49}`);
  });
});
