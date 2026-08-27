/**
 * Quality escalation.
 *
 * The rule every assertion here defends: escalation must never be able to
 * delay what the interpreter sees. An interpreter who has already said the
 * sentence cannot use a better version of it, and being shown one invites a
 * retraction in front of a room.
 */
import { describe, expect, it } from "vitest";
import {
  ESCALATION_DEADLINE_CEILING_MS,
  MIN_ESCALATION_HEADROOM_MS,
  escalationDecision,
  escalationImproves,
} from "./escalation";
import type { ParsedInterpreterOutput } from "@/lib/schema";

const output = (confidence: "high" | "medium" | "low"): ParsedInterpreterOutput => ({
  safeChunks: [{ text: "Something sayable.", confidence }],
  confidence,
});

const decide = (overrides: Partial<Parameters<typeof escalationDecision>[0]> = {}) =>
  escalationDecision({
    enabled: true,
    lag: "balanced",
    detectedKinds: [],
    primary: output("high"),
    elapsedMs: 0,
    turnBudgetMs: 5600,
    ...overrides,
  });

describe("when escalation fires", () => {
  it("fires on wordplay, where a fast model is likeliest to go literal", () => {
    expect(decide({ detectedKinds: ["wordplay"] }).escalate).toBe(true);
    expect(decide({ detectedKinds: ["idiom"] }).escalate).toBe(true);
    expect(decide({ detectedKinds: ["humour"] }).escalate).toBe(true);
  });

  it("fires when the primary model said it was not confident", () => {
    expect(decide({ primary: output("low") }).escalate).toBe(true);
  });

  it("does not fire on an ordinary confident turn", () => {
    // Escalating everything is just a slower, dearer primary model.
    expect(decide().escalate).toBe(false);
  });

  it("does not fire on a cultural note that is not a rendering hazard", () => {
    expect(decide({ detectedKinds: ["honorific"] }).escalate).toBe(false);
  });
});

describe("when escalation must not fire", () => {
  it("never fires when it is switched off", () => {
    expect(decide({ enabled: false, detectedKinds: ["wordplay"] }).escalate).toBe(false);
  });

  it("never fires on the FAST lag profile", () => {
    // FAST exists because the interpreter chose to accept correction risk in
    // exchange for speed. Spending their headroom inverts the trade they made.
    expect(decide({ lag: "fast", detectedKinds: ["wordplay"] }).escalate).toBe(false);
  });

  it("never fires without enough budget left to land in time", () => {
    const decision = decide({
      detectedKinds: ["wordplay"],
      elapsedMs: 5600 - (MIN_ESCALATION_HEADROOM_MS - 1),
    });
    expect(decision.escalate).toBe(false);
    expect(decision.reason).toContain("turn budget");
  });

  it("never fires once the budget is already spent", () => {
    expect(decide({ detectedKinds: ["wordplay"], elapsedMs: 9999 }).escalate).toBe(false);
  });
});

describe("the escalation deadline", () => {
  it("never exceeds the remaining turn budget", () => {
    const decision = decide({ detectedKinds: ["wordplay"], elapsedMs: 4000 });
    expect(decision.escalate).toBe(true);
    expect(decision.deadlineMs).toBeLessThanOrEqual(5600 - 4000);
  });

  it("is capped even when the whole budget is available", () => {
    const decision = decide({ detectedKinds: ["wordplay"], turnBudgetMs: 60_000 });
    expect(decision.deadlineMs).toBe(ESCALATION_DEADLINE_CEILING_MS);
  });
});

describe("whether the escalated answer is worth swapping in", () => {
  it("swaps only on a genuine confidence improvement", () => {
    expect(escalationImproves(output("low"), output("high"))).toBe(true);
    expect(escalationImproves(output("medium"), output("high"))).toBe(true);
  });

  it("refuses a sideways swap", () => {
    // Same confidence, different wording, is churn the interpreter has to
    // read through — the line changes under them for no gain.
    expect(escalationImproves(output("high"), output("high"))).toBe(false);
    expect(escalationImproves(output("medium"), output("medium"))).toBe(false);
  });

  it("refuses a downgrade", () => {
    expect(escalationImproves(output("high"), output("low"))).toBe(false);
  });

  it("refuses an empty escalated answer", () => {
    expect(escalationImproves(output("low"), { safeChunks: [], confidence: "high" })).toBe(false);
    expect(escalationImproves(output("low"), null)).toBe(false);
  });

  it("accepts anything usable when the primary produced nothing", () => {
    expect(escalationImproves(null, output("medium"))).toBe(true);
    expect(escalationImproves({ safeChunks: [], confidence: "low" }, output("medium"))).toBe(true);
  });
});
