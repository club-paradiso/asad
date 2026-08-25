import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import { __resetEnvCache } from "@/lib/env";
import { __resetRouter } from "@/providers/llm";
import type { AppConfig } from "./route";

/**
 * What the launcher is told about this deployment.
 *
 * These exist because of a real defect: `modelAvailable` was computed from the
 * Phase 1 variables (`LLM_PROVIDER` + `LLM_API_KEY`) alone, so a deployment
 * configured the documented Phase 2 way — `GROQ_API_KEY` and friends — was
 * told it had no model at all while the router was routing to Groq perfectly
 * well. "Connected but reported as disconnected" is the worst possible failure
 * for a config endpoint, because it sends the operator hunting for a problem
 * that is not there.
 */
const KEY = "x".repeat(32);

async function config(vars: Record<string, string>): Promise<AppConfig> {
  for (const key of Object.keys(process.env)) {
    if (/^(LLM|GEMINI|GROQ|OPENROUTER|OPENAI|ANTHROPIC|STT|DEEPGRAM|BIBLE)_/.test(key)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, vars);
  __resetEnvCache();
  __resetRouter();
  return (await GET()).json();
}

beforeEach(() => {
  __resetEnvCache();
  __resetRouter();
});

describe("GET /api/config — the LLM state the launcher shows", () => {
  it("reports a Phase 2 key as a configured model", async () => {
    const { llm } = await config({ GROQ_API_KEY: KEY });
    expect(llm.modelAvailable).toBe(true);
    expect(llm.configured).toBe("Groq");
  });

  it("still understands the Phase 1 variables", async () => {
    const { llm } = await config({ LLM_PROVIDER: "gemini", LLM_API_KEY: KEY });
    expect(llm.modelAvailable).toBe(true);
    expect(llm.configured).toBe("Google Gemini");
  });

  it("reports no model when there is genuinely no key", async () => {
    const { llm } = await config({});
    expect(llm.modelAvailable).toBe(false);
    expect(llm.configured).toBe("local interpreter");
  });

  it("reports no model in local routing mode even with a key present", async () => {
    // Deliberately configured to send nothing. That is not a misconfiguration.
    const { llm } = await config({ LLM_ROUTING_MODE: "local", GROQ_API_KEY: KEY });
    expect(llm.modelAvailable).toBe(false);
  });

  it("separates 'connected' from 'can carry a sermon'", async () => {
    // Groq's free tier connects fine and then runs out within minutes. From
    // the booth that is indistinguishable from a broken deployment unless the
    // launcher says which one it is.
    const { llm } = await config({ GROQ_API_KEY: KEY });
    expect(llm.modelAvailable).toBe(true);
    expect(llm.sustainsLiveSermon).toBe(false);
    expect(llm.capacityNote).toMatch(/over|limit/i);
  });

  it("raises no capacity warning for a provider with the headroom", async () => {
    const { llm } = await config({ GEMINI_API_KEY: KEY });
    expect(llm.sustainsLiveSermon).toBe(true);
    expect(llm.capacityNote).toBeUndefined();
  });

  it("raises no capacity warning when there is no model to begin with", async () => {
    // One problem should read as one problem.
    const { llm } = await config({});
    expect(llm.sustainsLiveSermon).toBe(true);
  });

  it("routes the live console and the counter to different providers", async () => {
    // Gemini has the quota for continuous speech; Groq has the open weights
    // and the privacy posture for a counter. Both keys present should get both.
    const { llm, counter } = await config({ GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY });
    expect(llm.configured).toBe("Google Gemini");
    expect(counter.provider).toBe("Groq");
    expect(counter.openWeightModel).toBe(true);
  });

  it("never exposes a key, in any field", async () => {
    const payload = await config({ GROQ_API_KEY: KEY, GEMINI_API_KEY: KEY });
    expect(JSON.stringify(payload)).not.toContain(KEY);
  });
});
