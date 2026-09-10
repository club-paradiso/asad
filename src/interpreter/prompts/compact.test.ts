import { describe, expect, it } from "vitest";
import { estimateTokens } from "@/lib/telemetry";
import { systemPromptFor } from "./live";

const sermon = systemPromptFor("sermon", { schemaEnforced: true, ultraCompact: true });
const general = systemPromptFor("general", { schemaEnforced: true, ultraCompact: true });
const fullSermon = systemPromptFor("sermon", { schemaEnforced: true });

const lower = (text: string) => text.toLowerCase();

describe("ultra-compact live system contract", () => {
  it("preserves the cross-mode safety rules that are load-bearing live", () => {
    for (const prompt of [sermon, general]) {
      const text = lower(prompt);
      expect(text).toContain("not the interpreter");
      expect(text).toContain("semantic fidelity");
      expect(text).toContain("zero hallucination");
      expect(prompt).toContain("3–12 words");
      expect(text).toContain("predicate");
      expect(prompt).toContain("제가 오늘 여러분과 나누고 싶은 것은");
      expect(text).toContain("never invent the payload");
      expect(text).toContain("repetition/refrains");
      expect(text).toContain("do not guess");
      expect(text).toContain("omission beats invention");
      expect(text).toContain("name it, do not recite it");
      expect(text).toContain("revised romanisation");
      expect(prompt).toContain("Ryu Jeong-gil");
      expect(text).toContain("at most two");
      expect(text).toContain("never predict a reference, a number, a name or a quotation");
      expect(text).toContain("coin flip");
    }
  });

  it("preserves sermon-specific Scripture, register, room-address and wordplay behavior", () => {
    const text = lower(sermon);
    expect(sermon).toContain("1 Peter 2:9");
    expect(text).toContain("reference only, never wording");
    expect(text).toContain("inventing scripture");
    expect(sermon).toContain("은혜 많이 받으세요");
    expect(text).toContain("receive much grace");
    expect(sermon).toContain("아멘?");
    expect(text).toContain("own tiny chunk");
    expect(text).toContain("adapted");
    expect(text).toContain("culturalnotes");
  });

  it("keeps general mode domain-neutral and polite without archaic English", () => {
    const text = lower(general);
    expect(text).toContain("assume nothing religious");
    expect(general).toContain("하십시오체");
    expect(text).toContain("never archaic english");
  });

  it("cuts the hot-path system prompt roughly in half", () => {
    const sermonTokens = estimateTokens(sermon);
    const generalTokens = estimateTokens(general);
    const fullTokens = estimateTokens(fullSermon);

    expect(sermonTokens).toBeLessThan(650);
    expect(generalTokens).toBeLessThan(525);
    expect(sermonTokens).toBeLessThan(fullTokens * 0.65);
  });

  it("leaves the full contract unchanged unless explicitly selected", () => {
    expect(fullSermon).not.toBe(sermon);
    expect(fullSermon.length).toBeGreaterThan(sermon.length);
  });
});
