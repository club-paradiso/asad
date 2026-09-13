/**
 * What the six contexts and an arbitrary language pair do to the prompt.
 *
 * The worship delta is the old sermon prompt and is pinned by `prompts.test.ts`.
 * These assert the things that are new: that the other five say something
 * specific rather than nothing, that the core stays shared so a prompt cache
 * still hits, and that a non-Korean pair produces a coherent contract instead
 * of a Korean one with the names swapped.
 */
import { describe, expect, it } from "vitest";
import { systemPromptFor } from "./live";
import { CORE_CONTRACT, coreContract } from "./shared";
import { targetScriptDirective } from "./domains";
import { estimateTokens } from "@/lib/telemetry";
import { RESOLVED_CONTEXTS } from "@/interpreter/context/context-mode";

const prompt = (context: (typeof RESOLVED_CONTEXTS)[number], options = {}) =>
  systemPromptFor(context, { schemaEnforced: true, ...options });

describe("every context", () => {
  it("shares the byte-identical core, so one prompt cache serves them all", () => {
    for (const context of RESOLVED_CONTEXTS) {
      expect(prompt(context).startsWith(CORE_CONTRACT), context).toBe(true);
    }
  });

  it("names its own domain exactly once", () => {
    for (const context of RESOLVED_CONTEXTS) {
      const matches = prompt(context).match(/^DOMAIN: /gmu) ?? [];
      expect(matches, context).toHaveLength(1);
    }
  });

  it("stays small enough to send eleven times a minute", () => {
    for (const context of RESOLVED_CONTEXTS) {
      expect(estimateTokens(prompt(context)), context).toBeLessThan(1200);
      expect(
        estimateTokens(prompt(context, { ultraCompact: true })),
        context,
      ).toBeLessThan(700);
    }
  });

  it("asks for the model's read of the setting, which costs no extra call", () => {
    // Non-schema-enforced, because that is the variant that spells the shape
    // out; the enforced one relies on INTERPRETER_JSON_SCHEMA.
    const text = systemPromptFor("generic", { schemaEnforced: false });
    expect(text).toContain('"context"');
    expect(text.toLowerCase()).toContain("costs nothing extra");
  });
});

describe("the contexts that replaced General Mode", () => {
  it("tells a lecture to keep its scaffolding and its figures", () => {
    const text = prompt("lecture").toLowerCase();
    expect(text).toContain("lecture");
    expect(text).toContain("never round a figure");
  });

  it("tells a meeting to preserve obligation, owner and deadline", () => {
    const text = prompt("meeting").toLowerCase();
    expect(text).toContain("modality");
    expect(text).toContain("owner and a deadline");
    expect(text).toContain("do not resolve an open question into a decision");
  });

  it("tells a conversation to keep the speech act and the turn short", () => {
    const text = prompt("conversation").toLowerCase();
    expect(text).toContain("a question stays a question");
    expect(text).toContain("do not merge a question and its answer");
  });

  it("tells an event that titles and running order are content", () => {
    const text = prompt("event").toLowerCase();
    expect(text).toContain("titles");
    expect(text).toContain("never approximate one");
  });

  it("keeps the generic contract religiously neutral", () => {
    const text = prompt("generic");
    expect(text.toLowerCase()).toContain("assume nothing religious");
    expect(text).not.toContain("Scripture reading");
  });
});

describe("an arbitrary language pair", () => {
  const koZh = { source: "ko-KR", target: "zh-TW" };
  const jaEn = { source: "ja-JP", target: "en-US" };
  const esEn = { source: "es-ES", target: "en-US" };

  it("names both languages rather than assuming Korean into English", () => {
    const text = systemPromptFor("generic", { languages: koZh });
    expect(text).toContain("working Korean into Chinese (Traditional)");
    expect(text).not.toContain("into English.");
  });

  it("keeps the delayed-predicate rule where the source actually has one", () => {
    expect(coreContract(jaEn)).toContain("Japanese holds the predicate");
    expect(coreContract(esEn)).not.toContain("holds the predicate");
    // ...and the general form of the same rule survives for every source.
    expect(coreContract(esEn).toLowerCase()).toContain("never invent the payload");
  });

  it("does not claim Revised Romanisation for a language it does not apply to", () => {
    expect(coreContract(jaEn)).not.toContain("Revised Romanisation");
    expect(coreContract(jaEn)).toContain("Once a form is settled, reuse it exactly");
    expect(CORE_CONTRACT).toContain("Revised Romanisation");
  });

  it("only adds Korean honorific guidance for a Korean source", () => {
    expect(systemPromptFor("generic", { languages: koZh })).toContain("하십시오체");
    expect(systemPromptFor("generic", { languages: jaEn })).not.toContain("하십시오체");
  });

  it("states the target script when the tag's meaning is a script variant", () => {
    expect(targetScriptDirective("zh-TW")).toContain("繁體中文");
    expect(targetScriptDirective("zh-CN")).toContain("简体中文");
    expect(targetScriptDirective("en-US")).toBeNull();
    expect(targetScriptDirective("ko-KR")).toBeNull();

    // And it reaches the prompt, because "Chinese" alone produces Simplified.
    expect(systemPromptFor("worship", { languages: koZh })).toContain("繁體中文");
    expect(
      systemPromptFor("worship", { languages: koZh, ultraCompact: true }),
    ).toContain("繁體中文");
  });
});
