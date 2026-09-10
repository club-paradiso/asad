import { describe, expect, it } from "vitest";
import {
  LIVE_WORKLOAD,
  assessFreeTierViability,
  liveTokensPerCallForProvider,
} from "./capabilities";

describe("provider-aware live workload accounting", () => {
  it("uses the refreshed ultra-compact cost for constrained live providers", () => {
    expect(liveTokensPerCallForProvider("groq")).toBe(
      LIVE_WORKLOAD.tokensPerCallUltraCompact,
    );
    expect(liveTokensPerCallForProvider("openrouter")).toBe(
      LIVE_WORKLOAD.tokensPerCallUltraCompact,
    );
  });

  it("keeps the full cost for providers with full live headroom", () => {
    expect(liveTokensPerCallForProvider("gemini")).toBe(LIVE_WORKLOAD.tokensPerCallFull);
    expect(liveTokensPerCallForProvider("openai")).toBe(LIVE_WORKLOAD.tokensPerCallFull);
  });

  it("reports Groq against the actual ultra-compact live workload", () => {
    const verdict = assessFreeTierViability("groq");
    expect(verdict.viable).toBe(false);
    expect(verdict.bindingLimit).toBe("tpm");
    expect(verdict.detail).toContain(`${LIVE_WORKLOAD.tokensPerCallUltraCompact} per call`);
    expect(verdict.detail).toContain("9,495 tokens/min");
  });

  it("keeps OpenRouter bound by its daily free-model request cap", () => {
    const verdict = assessFreeTierViability("openrouter");
    expect(verdict.viable).toBe(false);
    expect(verdict.bindingLimit).toBe("rpd");
    expect(verdict.sustainedMinutes).toBe(4);
  });
});
