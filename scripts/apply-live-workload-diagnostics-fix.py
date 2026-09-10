from pathlib import Path

# capabilities.ts: make the default live quota estimate match the provider's
# baseline context profile instead of always assuming the full prompt.
p = Path('src/providers/llm/capabilities.ts')
s = p.read_text()
needle = '''export interface QuotaVerdict {
  viable: boolean;
  /** Which limit binds first, if any. */
  bindingLimit?: "rpm" | "tpm" | "rpd";
  /** Minutes of continuous interpretation before the daily cap is hit. */
  sustainedMinutes?: number;
  detail: string;
}

/**
 * Can this provider actually sustain a live sermon on its free tier?
'''
replacement = '''export interface QuotaVerdict {
  viable: boolean;
  /** Which limit binds first, if any. */
  bindingLimit?: "rpm" | "tpm" | "rpd";
  /** Minutes of continuous interpretation before the daily cap is hit. */
  sustainedMinutes?: number;
  detail: string;
}

/**
 * Baseline prompt cost the live router will actually send for this provider.
 * Mirrors the zero-pressure BALANCED profile decision without importing the
 * context budgeter back into the provider registry (which would create a
 * dependency cycle).
 */
export function liveTokensPerCallForProvider(id: LlmProviderId): number {
  const recommended = PROVIDER_CAPABILITIES[id].recommendedLiveContextTokens;
  if (recommended !== undefined && recommended < LIVE_WORKLOAD.tokensPerCallCompact) {
    return LIVE_WORKLOAD.tokensPerCallUltraCompact;
  }
  if (recommended !== undefined && recommended < LIVE_WORKLOAD.tokensPerCallFull) {
    return LIVE_WORKLOAD.tokensPerCallCompact;
  }
  return LIVE_WORKLOAD.tokensPerCallFull;
}

/**
 * Can this provider actually sustain a live sermon on its free tier?
'''
assert needle in s
s = s.replace(needle, replacement, 1)
s = s.replace(
    'tokensPerCall: number = LIVE_WORKLOAD.tokensPerCallFull,',
    'tokensPerCall: number = liveTokensPerCallForProvider(id),',
    1,
)
p.write_text(s)

# config route: stop overriding the provider-aware default with stale full cost.
p = Path('src/app/api/config/route.ts')
s = p.read_text()
s = s.replace('  LIVE_WORKLOAD,\n', '')
s = s.replace(
    'assessFreeTierViability(id, LIVE_WORKLOAD.tokensPerCallFull).viable;',
    'assessFreeTierViability(id).viable;',
)
s = s.replace(
    'assessFreeTierViability(active, LIVE_WORKLOAD.tokensPerCallFull)',
    'assessFreeTierViability(active)',
)
p.write_text(s)

# diagnostics route: same provider-aware truth for live chain and provider cards.
p = Path('src/app/api/diagnostics/route.ts')
s = p.read_text()
s = s.replace(
    'assessFreeTierViability(id, LIVE_WORKLOAD.tokensPerCallFull).viable',
    'assessFreeTierViability(id).viable',
)
s = s.replace(
    'assessFreeTierViability(id, LIVE_WORKLOAD.tokensPerCallFull)',
    'assessFreeTierViability(id)',
)
p.write_text(s)

# Diagnostics UI: label the refreshed ultra-compact measurement explicitly.
p = Path('src/features/diagnostics/DiagnosticsScreen.tsx')
s = p.read_text()
old = '''        Generated {new Date(data.generatedAt).toLocaleString()}. Measured workload:{" "}
        {String(data.workload.callsPerMinute)} calls/min at {String(data.workload.tokensPerCallFull)}{" "}
        tokens per call.
'''
new = '''        Generated {new Date(data.generatedAt).toLocaleString()}. Measured workload:{" "}
        {String(data.workload.callsPerMinute)} calls/min; ultra-compact{" "}
        {String(data.workload.tokensPerCallUltraCompact)} tokens per call.
'''
assert old in s
p.write_text(s.replace(old, new, 1))

# Focused regression: runtime viability must use the same baseline profile cost
# that the live route selects for each provider.
Path('src/providers/llm/live-workload.test.ts').write_text(r'''import { describe, expect, it } from "vitest";
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
''')
