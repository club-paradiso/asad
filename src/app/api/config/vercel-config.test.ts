import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface VercelConfig {
  env?: Record<string, string>;
}

const loadVercelConfig = (): VercelConfig =>
  JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as VercelConfig;

describe("public Vercel interpretation configuration", () => {
  it("does not hard-block Live Mode when the deployment is pinned to a free OpenRouter model", () => {
    const env = loadVercelConfig().env ?? {};

    expect(env.LLM_PROVIDER).toBe("openrouter");
    expect(env.OPENROUTER_PRIMARY_MODEL).toMatch(/:free$/);
    expect(env.LLM_ALLOW_PAID_FALLBACK).toBe("false");
    expect(env.OPENROUTER_QUALITY_ESCALATION).toBe("false");

    // The public deployment deliberately exposes only a non-billable OpenRouter
    // path. Requiring a provider that can sustain an entire 45-minute session
    // makes /api/interpret reject that only cloud path and silently fall back to
    // the deterministic local helper, which is not a translator.
    expect(env.LLM_LIVE_REQUIRE_SUSTAINABLE).toBe("false");
  });
});
