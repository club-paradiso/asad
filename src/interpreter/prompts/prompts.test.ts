/**
 * The live prompt contract.
 *
 * The system prompt was cut by ~37% on the live path. That is only a good
 * change if the behaviour it encodes survived, and "I was careful" is not
 * evidence. These assertions are the evidence: each one names a rule that
 * exists because of a specific failure mode in live interpretation, and a
 * future compression that drops one fails here rather than in a service.
 *
 * They assert MEANING, not wording, so the prompt can still be edited.
 */
import { describe, expect, it } from "vitest";
import { systemPromptFor } from "./live";
import { CORE_CONTRACT } from "./shared";
import { estimateTokens } from "@/lib/telemetry";

const sermon = systemPromptFor("sermon", { schemaEnforced: true });
const general = systemPromptFor("general", { schemaEnforced: true });
const both = [sermon, general];

/** Case-insensitive substring, so capitalisation is free to change. */
const mentions = (prompt: string, needle: string) =>
  prompt.toLowerCase().includes(needle.toLowerCase());

describe("rules that must survive any compression", () => {
  it("states that the model is not the interpreter", () => {
    for (const prompt of both) {
      expect(mentions(prompt, "not the interpreter")).toBe(true);
    }
  });

  it("keeps fidelity and zero hallucination above naturalness and latency", () => {
    // The order is the conflict-resolution rule. Losing it means a model that
    // invents to sound fluent, which is the single worst outcome here.
    const priorities = CORE_CONTRACT.slice(
      CORE_CONTRACT.indexOf("PRIORITIES"),
      CORE_CONTRACT.indexOf("CHUNKS"),
    ).toLowerCase();
    expect(priorities.indexOf("fidelity")).toBeLessThan(priorities.indexOf("naturalness"));
    expect(priorities.indexOf("hallucination")).toBeLessThan(priorities.indexOf("latency"));
  });

  it("bounds chunk length so the output stays speakable", () => {
    for (const prompt of both) expect(prompt).toContain("3–12 words");
  });

  it("teaches delayed-predicate scaffolding with a worked example", () => {
    for (const prompt of both) {
      expect(mentions(prompt, "predicate")).toBe(true);
      // The Korean example is what makes the rule actionable rather than
      // abstract; dropping it was measurably worse in the benchmark.
      expect(prompt).toContain("제가 오늘 여러분과 나누고 싶은 것은");
    }
  });

  it("forbids inventing the unresolved payload", () => {
    for (const prompt of both) {
      expect(mentions(prompt, "never invent the payload")).toBe(true);
    }
  });

  it("preserves deliberate rhetorical repetition rather than compressing it", () => {
    for (const prompt of both) {
      expect(mentions(prompt, "refrain")).toBe(true);
    }
  });

  it("forbids guessing names, numbers and dates", () => {
    for (const prompt of both) {
      expect(mentions(prompt, "do not guess")).toBe(true);
      expect(mentions(prompt, "omission beats invention")).toBe(true);
    }
  });

  it("forbids reciting wording that was not supplied, in either mode", () => {
    // Generalised from the Scripture-only rule: a general-mode speaker quotes
    // contracts and regulations, and inventing those is the same failure.
    for (const prompt of both) {
      expect(mentions(prompt, "name it, do not recite it")).toBe(true);
    }
  });

  it("keeps every anticipation safety rule", () => {
    for (const prompt of both) {
      expect(mentions(prompt, "at most two")).toBe(true);
      expect(mentions(prompt, "never predict a reference, a number, a name or a quotation")).toBe(
        true,
      );
      expect(mentions(prompt, "coin flip")).toBe(true);
    }
  });

  it("specifies Revised Romanisation and reuse of settled forms", () => {
    for (const prompt of both) {
      expect(mentions(prompt, "revised romanisation")).toBe(true);
      expect(prompt).toContain("Ryu Jeong-gil");
    }
  });
});

describe("sermon-specific rules", () => {
  it("normalises spoken Scripture references", () => {
    expect(sermon).toContain("1 Peter 2:9");
  });

  it("refuses to supply verse wording that was not given", () => {
    expect(mentions(sermon, "reference only, never wording")).toBe(true);
    expect(mentions(sermon, "inventing scripture")).toBe(true);
  });

  it("keeps the technical-vs-relational register distinction", () => {
    // A lookup table can supply the terms; only the prompt can supply the
    // principle that decides which way a term goes.
    expect(sermon).toContain("칭의");
    expect(mentions(sermon, "은혜 많이 받으세요")).toBe(true);
    expect(mentions(sermon, "receive much grace")).toBe(true);
  });

  it("keeps the wordplay worked example and the adapted flag", () => {
    expect(sermon).toContain("류정길");
    expect(mentions(sermon, "adapted")).toBe(true);
    expect(mentions(sermon, "culturalnotes")).toBe(true);
  });

  it("handles congregation address as its own droppable chunk", () => {
    expect(sermon).toContain("아멘?");
    expect(mentions(sermon, "own tiny chunk")).toBe(true);
  });

  it("no longer carries a static theological glossary", () => {
    // The local matcher scans each segment against 90+ entries and injects the
    // ones actually present. A fixed subset sent on every call was the worse
    // version of a feature that already existed.
    // Checked by their English glosses rather than the Korean: 복음 is a
    // substring of 요한복음 in the Scripture normalisation example, so a bare
    // substring search reports a term that is not there.
    const glosses = [
      "salvation",
      "the resurrection",
      "the gospel",
      "the cross",
      "baptism",
      "Communion",
      "the deacon",
      "the elder",
    ];
    const carried = glosses.filter((gloss) => sermon.includes(gloss));
    expect(carried).toEqual([]);
  });
});

describe("general mode", () => {
  it("assumes nothing religious", () => {
    expect(mentions(general, "assume nothing religious")).toBe(true);
    expect(general).not.toContain("Scripture reading");
  });

  it("carries respect rather than honorific grammar", () => {
    expect(general).toContain("하십시오체");
    expect(mentions(general, "never archaic english")).toBe(true);
  });
});

describe("size", () => {
  /**
   * A ceiling, not a target.
   *
   * The system prompt is sent ~11 times a minute and changes on none of those
   * calls. Before this work it was ~1,700 tokens — about two thirds of every
   * live request. This test is what stops it drifting back.
   */
  it("keeps the live system prompt under 1,200 tokens", () => {
    expect(estimateTokens(sermon)).toBeLessThan(1200);
    expect(estimateTokens(general)).toBeLessThan(1000);
  });

  it("shares a byte-identical core between modes, so a prompt cache can hit", () => {
    expect(sermon.startsWith(CORE_CONTRACT)).toBe(true);
    expect(general.startsWith(CORE_CONTRACT)).toBe(true);
  });
});
