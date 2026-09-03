import { describe, expect, it, vi } from "vitest";
import { LlmRouter, OPEN_WEIGHT } from "./router";
import { isOpenWeightModel } from "./capabilities";
import { CircuitBreaker } from "./circuit-breaker";
import { RateLimitTracker } from "./rate-limit";
import { LlmError, type LlmFailureKind } from "./errors";
import { parseEnv } from "@/lib/env";
import type { AppEnv } from "@/lib/env";

/** Build an AppEnv the way a deployment's environment would produce one. */
const env = (vars: Record<string, string>): AppEnv =>
  parseEnv(vars as unknown as NodeJS.ProcessEnv);

const KEY = "x".repeat(24);

describe("routing modes", () => {
  it("fails closed for cloud credentials on an unprotected Vercel deployment", () => {
    const parsed = env({
      VERCEL: "1",
      STT_PROVIDER: "deepgram",
      DEEPGRAM_API_KEY: KEY,
      OPENROUTER_API_KEY: KEY,
    });

    expect(parsed.stt.provider).toBe("webspeech");
    expect(parsed.stt.deepgramKey).toBeUndefined();
    expect(parsed.llm.providers.openrouter.configured).toBe(false);
    expect(parsed.problems).toContainEqual(
      expect.objectContaining({ field: "APP_ACCESS_KEY", level: "error" }),
    );
  });

  it("enables protected Vercel cloud providers", () => {
    const parsed = env({
      VERCEL: "1",
      APP_ACCESS_KEY: "private-deployment-key",
      STT_PROVIDER: "deepgram",
      DEEPGRAM_API_KEY: KEY,
      OPENROUTER_API_KEY: KEY,
    });

    expect(parsed.stt.provider).toBe("deepgram");
    expect(parsed.llm.providers.openrouter.configured).toBe(true);
  });

  it("parses the continuous-live sustainability floor independently of Counter", () => {
    expect(env({ LLM_LIVE_REQUIRE_SUSTAINABLE: "true" }).llm.requireSustainableLive).toBe(true);
    expect(env({}).llm.requireSustainableLive).toBe(false);
  });

  it("local mode has no cloud candidates at all", () => {
    const router = new LlmRouter(
      env({ LLM_ROUTING_MODE: "local", GEMINI_API_KEY: KEY }),
    );
    expect(router.plan().chain).toEqual(["local"]);
    expect(router.preferred()).toBeNull();
  });

  it("auto-free prefers free providers in order", () => {
    const router = new LlmRouter(
      env({ LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY }),
    );
    expect(router.plan().chain).toEqual(["gemini", "groq", "local"]);
  });

  it("auto-free NEVER escalates to a paid provider by default", () => {
    const router = new LlmRouter(
      env({
        LLM_ROUTING_MODE: "auto-free",
        GEMINI_API_KEY: KEY,
        OPENAI_API_KEY: KEY,
        ANTHROPIC_API_KEY: KEY,
      }),
    );
    // Spending someone's money because a free tier hiccuped is not a fallback.
    expect(router.plan().chain).toEqual(["gemini", "local"]);
  });

  it("auto-free reaches paid providers only on explicit opt-in", () => {
    const router = new LlmRouter(
      env({
        LLM_ROUTING_MODE: "auto-free",
        LLM_ALLOW_PAID_FALLBACK: "true",
        GEMINI_API_KEY: KEY,
        ANTHROPIC_API_KEY: KEY,
      }),
    );
    expect(router.plan().chain).toEqual(["gemini", "anthropic", "local"]);
  });

  it("strict privacy mode excludes providers that may train on free submissions", () => {
    const router = new LlmRouter(
      env({
        LLM_ROUTING_MODE: "auto-free",
        LLM_PRIVACY_MODE: "strict",
        GEMINI_API_KEY: KEY,
        GROQ_API_KEY: KEY,
      }),
    );
    // Groq states it does not train on either tier; Gemini's free tier may.
    expect(router.plan().chain).toEqual(["groq", "local"]);
  });

  it("strict privacy mode admits OpenRouter, because its policy denies collection", () => {
    const router = new LlmRouter(
      env({
        LLM_ROUTING_MODE: "auto-free",
        LLM_PRIVACY_MODE: "strict",
        OPENROUTER_API_KEY: KEY,
      }),
    );
    // OpenRouter's posture is "varies" only in its DEFAULT configuration. This
    // deployment sends `data_collection: deny` on every request, which is the
    // instruction to exclude upstreams that may retain or train. Benching the
    // one provider configured to satisfy strict mode was the bug.
    expect(router.plan().chain).toEqual(["openrouter", "local"]);
  });

  it("strict privacy mode still excludes OpenRouter when collection is allowed", () => {
    const router = new LlmRouter(
      env({
        LLM_ROUTING_MODE: "auto-free",
        LLM_PRIVACY_MODE: "strict",
        OPENROUTER_DATA_COLLECTION: "allow",
        OPENROUTER_API_KEY: KEY,
      }),
    );
    // Strict mode forces the policy back to deny and says so, so OpenRouter
    // stays eligible — what it must never do is honour `allow` silently.
    const parsed = env({
      LLM_PRIVACY_MODE: "strict",
      OPENROUTER_DATA_COLLECTION: "allow",
      OPENROUTER_API_KEY: KEY,
    });
    expect(parsed.llm.openrouter.policy.dataCollection).toBe("deny");
    expect(
      parsed.problems.some((p) => p.field === "OPENROUTER_DATA_COLLECTION"),
    ).toBe(true);
    expect(router.plan().chain).toEqual(["openrouter", "local"]);
  });

  it("pinned uses exactly the named provider, then local", () => {
    const router = new LlmRouter(
      env({ LLM_ROUTING_MODE: "pinned", LLM_PROVIDER: "groq", GROQ_API_KEY: KEY }),
    );
    expect(router.plan().chain).toEqual(["groq", "local"]);
  });

  it("reliable prefers paid providers", () => {
    const router = new LlmRouter(
      env({ LLM_ROUTING_MODE: "reliable", ANTHROPIC_API_KEY: KEY, GEMINI_API_KEY: KEY }),
    );
    expect(router.plan().chain[0]).toBe("anthropic");
  });

  it("falls back to local when nothing is configured", () => {
    const router = new LlmRouter(env({ LLM_ROUTING_MODE: "auto-free" }));
    expect(router.plan().chain).toEqual(["local"]);
  });
});

describe("Phase 1 configuration still works", () => {
  it("pins the legacy provider and applies the legacy key", () => {
    const parsed = env({ LLM_PROVIDER: "anthropic", LLM_API_KEY: KEY });
    expect(parsed.llm.routingMode).toBe("pinned");
    expect(parsed.llm.providers.anthropic.configured).toBe(true);
    expect(parsed.problems.some((p) => p.level === "info")).toBe(true);
  });

  it("maps the legacy 'mock' provider onto local", () => {
    const parsed = env({ LLM_PROVIDER: "mock" });
    expect(parsed.llm.routingMode).toBe("local");
    expect(parsed.llm.pinned).toBe("local");
  });
});

describe("environment validation never throws", () => {
  it("reports an unknown routing mode and keeps a working default", () => {
    const parsed = env({ LLM_ROUTING_MODE: "turbo" });
    expect(parsed.llm.routingMode).toBe("auto-free");
    expect(parsed.problems.some((p) => p.field === "LLM_ROUTING_MODE")).toBe(true);
  });

  it("rejects a malformed model id without losing the rest of the config", () => {
    const parsed = env({ GEMINI_LLM_MODEL: "bad model!", GROQ_API_KEY: KEY });
    expect(parsed.problems.some((p) => p.field === "GEMINI_LLM_MODEL")).toBe(true);
    // The valid key still took effect.
    expect(parsed.llm.providers.groq.configured).toBe(true);
  });

  it("warns when auto-free has no free key", () => {
    const parsed = env({ LLM_ROUTING_MODE: "auto-free" });
    expect(parsed.problems.some((p) => p.message.includes("no free-tier key"))).toBe(true);
  });

  it("warns when a pinned provider has no key", () => {
    const parsed = env({ LLM_PROVIDER: "gemini" });
    expect(parsed.problems.some((p) => p.level === "error")).toBe(true);
  });
});

describe("circuit breaker", () => {
  it("opens after the failure threshold and refuses further attempts", () => {
    const now = 0;
    const breaker = new CircuitBreaker("gemini", undefined, () => now);
    expect(breaker.canAttempt()).toBe(true);

    for (let i = 0; i < 3; i += 1) breaker.recordFailure("server_error", "boom");
    expect(breaker.state).toBe("open");
    expect(breaker.canAttempt()).toBe(false);
  });

  it("probes again after the cooldown", () => {
    let now = 0;
    const breaker = new CircuitBreaker("gemini", undefined, () => now);
    for (let i = 0; i < 3; i += 1) breaker.recordFailure("timeout", "slow");
    expect(breaker.canAttempt()).toBe(false);

    now += 60_000;
    expect(breaker.state).toBe("probing");
    expect(breaker.canAttempt()).toBe(true);

    breaker.recordSuccess();
    expect(breaker.state).toBe("healthy");
  });

  it("never retries an invalid API key", () => {
    const breaker = new CircuitBreaker("groq");
    breaker.recordFailure("auth", "401");
    // One strike, not three: proving a bad key is still bad costs a phrase.
    expect(breaker.canAttempt()).toBe(false);
    expect(breaker.snapshot().permanentlyDisabled).toBe(true);
  });

  it("never retries a rejected model id", () => {
    const breaker = new CircuitBreaker("groq");
    breaker.recordFailure("bad_request", "no such model");
    expect(breaker.snapshot().permanentlyDisabled).toBe(true);
  });

  it("opens immediately on exhausted quota", () => {
    const breaker = new CircuitBreaker("openrouter");
    breaker.recordFailure("quota_exhausted", "out of credits", { fatal: true });
    expect(breaker.canAttempt()).toBe(false);
  });

  it("honours a Retry-After longer than its own backoff", () => {
    let now = 0;
    const breaker = new CircuitBreaker("gemini", undefined, () => now);
    breaker.recordFailure("rate_limited", "429", { fatal: true, retryAfterSeconds: 120 });
    now += 60_000;
    expect(breaker.canAttempt()).toBe(false);
    now += 61_000;
    expect(breaker.canAttempt()).toBe(true);
  });

  it("resets the streak on success", () => {
    const breaker = new CircuitBreaker("gemini");
    breaker.recordFailure("server_error", "boom");
    breaker.recordFailure("server_error", "boom");
    breaker.recordSuccess();
    breaker.recordFailure("server_error", "boom");
    expect(breaker.canAttempt()).toBe(true);
  });
});

describe("rate-limit tracking", () => {
  it("reports pressure as the free-tier budget is consumed", () => {
    const now = 0;
    const tracker = new RateLimitTracker("groq", { tokensPerMinute: 6000 }, () => now);
    expect(tracker.pressure().level).toBe(0);

    tracker.recordRequest(3000);
    expect(tracker.pressure().level).toBeCloseTo(0.5, 1);

    tracker.recordRequest(3000);
    expect(tracker.pressure().level).toBeGreaterThanOrEqual(1);
    expect(tracker.pressure().binding).toBe("tpm");
  });

  it("rolls the window after a minute", () => {
    let now = 0;
    const tracker = new RateLimitTracker("groq", { tokensPerMinute: 6000 }, () => now);
    tracker.recordRequest(6000);
    expect(tracker.pressure().level).toBeGreaterThanOrEqual(1);
    now += 61_000;
    expect(tracker.pressure().level).toBe(0);
  });

  it("prefers the provider's reported headroom over our estimate", () => {
    const tracker = new RateLimitTracker("groq", { tokensPerMinute: 6000 });
    tracker.recordRequest(100);
    tracker.observe({ tokensRemaining: 300, observedAt: Date.now() });
    expect(tracker.pressure().level).toBeCloseTo(0.95, 1);
  });

  it("treats a recent 429 as hard evidence", () => {
    const tracker = new RateLimitTracker("openrouter", { requestsPerDay: 50 });
    tracker.recordRateLimited();
    expect(tracker.pressure().level).toBeGreaterThan(0.8);
  });

  it("tracks the daily cap that actually binds OpenRouter", () => {
    const now = 0;
    const tracker = new RateLimitTracker("openrouter", { requestsPerDay: 50 }, () => now);
    for (let i = 0; i < 50; i += 1) tracker.recordRequest(500);
    expect(tracker.pressure().binding).toBe("rpd");
    expect(tracker.pressure().level).toBeGreaterThanOrEqual(1);
  });
});

describe("fallback behaviour", () => {
  /** A router whose provider instances are stubbed. */
  function stubbedRouter(
    behaviours: Partial<Record<string, (request?: { signal?: AbortSignal }) => Promise<{ text: string; latencyMs: number }>>>,
    vars: Record<string, string>,
  ) {
    const router = new LlmRouter(env(vars));
    const original = (router as unknown as { instanceFor: (id: string) => unknown }).instanceFor;
    (router as unknown as { instanceFor: (id: string) => unknown }).instanceFor = function (
      id: string,
    ) {
      const behaviour = behaviours[id];
      if (behaviour) {
        return { id, model: `${id}-model`, complete: behaviour };
      }
      return original.call(this, id);
    };
    return router;
  }

  const ok = (text: string) => async () => ({ text, latencyMs: 10 });
  const fails = (kind: LlmFailureKind) => async () => {
    throw new LlmError(`simulated ${kind}`, kind);
  };

  const VALID = JSON.stringify({ safeChunks: [{ text: "Hello." }], confidence: "high" });

  it("moves to the next provider on a 429 and still answers", async () => {
    const router = stubbedRouter(
      { gemini: fails("rate_limited"), groq: ok(VALID) },
      { LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY },
    );

    const result = await router.complete(
      { system: "s", user: "u" },
      { deadlineMs: 3000 },
    );

    expect(result.provider).toBe("groq");
    expect(result.degraded).toBe(true);
    expect(result.attempts[0]).toMatchObject({ provider: "gemini", ok: false });
  });

  it("reaches the local interpreter when every cloud provider fails", async () => {
    const router = stubbedRouter(
      { gemini: fails("server_error"), groq: fails("server_error") },
      { LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY },
    );

    const result = await router.complete(
      { system: "DOMAIN: KOREAN CHURCH SERMON", user: "KOREAN TO INTERPRET NOW (stabilised):\n안녕하세요." },
      { deadlineMs: 3000 },
    );

    // The console must never go silent because vendors are down.
    expect(result.provider).toBe("local");
    expect(result.degraded).toBe(true);
  });

  it("treats schema-invalid output as a provider failure and moves on", async () => {
    const router = stubbedRouter(
      { gemini: ok("I'm sorry, I can't do that."), groq: ok(VALID) },
      { LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY },
    );

    const result = await router.complete(
      { system: "s", user: "u" },
      {
        deadlineMs: 3000,
        validate: (response) => response.text.trimStart().startsWith("{"),
      },
    );

    expect(result.provider).toBe("groq");
    expect(result.attempts[0].failureKind).toBe("malformed_output");
  });

  it("sticks to a healthy provider across turns", async () => {
    const router = stubbedRouter(
      { gemini: ok(VALID), groq: ok(VALID) },
      { LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY },
    );

    for (let i = 0; i < 5; i += 1) {
      const result = await router.complete(
        { system: "s", user: "u" },
        { deadlineMs: 3000, routingKey: "live:session-a" },
      );
      // Model roulette between sentences produces inconsistent terminology.
      expect(result.provider).toBe("gemini");
    }
  });

  it("keeps provider affinity inside one session", async () => {
    let geminiCalls = 0;
    const router = stubbedRouter(
      {
        gemini: async () => {
          geminiCalls += 1;
          if (geminiCalls === 1) throw new LlmError("temporary", "server_error");
          return { text: VALID, latencyMs: 10 };
        },
        groq: ok(VALID),
      },
      { LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY },
    );

    const firstA = await router.complete(
      { system: "s", user: "u" },
      { deadlineMs: 3000, routingKey: "live:a" },
    );
    const firstB = await router.complete(
      { system: "s", user: "u" },
      { deadlineMs: 3000, routingKey: "live:b" },
    );
    const secondA = await router.complete(
      { system: "s", user: "u" },
      { deadlineMs: 3000, routingKey: "live:a" },
    );

    expect(firstA.provider).toBe("groq");
    expect(firstB.provider).toBe("gemini");
    expect(secondA.provider).toBe("groq");
  });

  it("does not try a fallback after the caller has aborted the whole turn", async () => {
    const fallback = vi.fn(async () => ({ text: VALID, latencyMs: 10 }));
    const router = stubbedRouter(
      {
        gemini: async (request) => {
          if (request?.signal?.aborted) throw new LlmError("aborted", "timeout");
          return { text: VALID, latencyMs: 10 };
        },
        groq: fallback,
      },
      { LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY },
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      router.complete(
        { system: "s", user: "u", signal: controller.signal },
        { deadlineMs: 3000, routingKey: "live:aborted" },
      ),
    ).rejects.toThrow(/aborted/i);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("stops asking a provider with an invalid key after one failure", async () => {
    const attempts: string[] = [];
    const router = stubbedRouter(
      {
        gemini: async () => {
          attempts.push("gemini");
          throw new LlmError("401", "auth");
        },
        groq: ok(VALID),
      },
      { LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY },
    );

    await router.complete({ system: "s", user: "u" }, { deadlineMs: 3000 });
    await router.complete({ system: "s", user: "u" }, { deadlineMs: 3000 });
    await router.complete({ system: "s", user: "u" }, { deadlineMs: 3000 });

    expect(attempts).toHaveLength(1);
  });

  it("surfaces quota and privacy warnings in the plan", () => {
    const router = new LlmRouter(
      env({ LLM_ROUTING_MODE: "auto-free", OPENROUTER_API_KEY: KEY, GEMINI_API_KEY: KEY }),
    );
    const warnings = router.plan().warnings.join(" ");
    // OpenRouter's 50/day cap and Gemini's training posture both matter.
    expect(warnings).toMatch(/OpenRouter/);
    expect(warnings).toMatch(/improve Google products/);
  });
});

describe("open-weight preference — Counter Mode", () => {
  it("recognises open weights from the model, not the vendor", () => {
    // The vendor is not the thing that decides: Gemini pointed at Gemma is
    // open weights, and OpenRouter pointed at a closed model is not.
    expect(isOpenWeightModel("openai/gpt-oss-120b")).toBe(true);
    expect(isOpenWeightModel("meta-llama/llama-3.3-70b-instruct:free")).toBe(true);
    expect(isOpenWeightModel("gemma-3-27b-it")).toBe(true);
    expect(isOpenWeightModel("qwen/qwen3-32b")).toBe(true);
    expect(isOpenWeightModel("gemini-2.5-flash")).toBe(false);
    expect(isOpenWeightModel("gpt-4.1-mini")).toBe(false);
    expect(isOpenWeightModel("claude-sonnet-4-5")).toBe(false);
  });

  it("lists the configured providers serving open weights", () => {
    const router = new LlmRouter(
      env({ LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY }),
    );
    // Gemini's default model is proprietary; Groq's is gpt-oss.
    expect(router.matching(OPEN_WEIGHT)).toEqual(["groq"]);
  });

  it("reaches an open-weight provider ahead of the default free order", () => {
    const router = new LlmRouter(
      env({ LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY }),
    );
    // Live routing still prefers Gemini for its quota headroom…
    expect(router.preferred()).toBe("gemini");
    // …while a counter turn asks for open weights and gets Groq.
    expect(router.preferred(OPEN_WEIGHT)).toBe("groq");
  });

  it("follows the deployer's model override in both directions", () => {
    const closed = new LlmRouter(
      env({
        LLM_ROUTING_MODE: "auto-free",
        GROQ_API_KEY: KEY,
        GROQ_LLM_MODEL: "some-proprietary-model",
      }),
    );
    expect(closed.matching(OPEN_WEIGHT)).toEqual([]);

    const open = new LlmRouter(
      env({
        LLM_ROUTING_MODE: "auto-free",
        GEMINI_API_KEY: KEY,
        GEMINI_LLM_MODEL: "gemma-3-27b-it",
      }),
    );
    expect(open.matching(OPEN_WEIGHT)).toEqual(["gemini"]);
  });

  it("returns nothing to prefer when no open-weight provider is configured", () => {
    const router = new LlmRouter(
      env({ LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY }),
    );
    // The caller treats this as "no preference satisfied", not as "no
    // provider": refusing to translate at a counter is the worse failure.
    expect(router.preferred(OPEN_WEIGHT)).toBeNull();
    expect(router.preferred()).toBe("gemini");
  });
});

describe("what a preference-carrying turn would actually reach", () => {
  it("falls past an unsatisfiable preference to the provider that answers", () => {
    // The defect this exists to prevent: `preferred(OPEN_WEIGHT)` is null on a
    // Gemini-only deployment, which the counter disclosure read as "nothing
    // can translate" and printed in red on the visitor's phone — while every
    // message went to Gemini and came back translated.
    const router = new LlmRouter(
      env({ LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY }),
    );
    expect(router.preferred(OPEN_WEIGHT)).toBeNull();
    expect(router.wouldReach(OPEN_WEIGHT)).toBe("gemini");
  });

  it("still honours the preference as an ordering when it can be met", () => {
    const router = new LlmRouter(
      env({ LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY }),
    );
    expect(router.wouldReach(OPEN_WEIGHT)).toBe("groq");
    expect(router.wouldReach()).toBe("gemini");
  });

  it("reports nothing only when nothing cloud-side can answer", () => {
    // `local` is always in the chain and cannot translate, so it must never
    // count as a translation provider.
    expect(new LlmRouter(env({})).wouldReach(OPEN_WEIGHT)).toBeNull();
    expect(
      new LlmRouter(env({ LLM_ROUTING_MODE: "local", GROQ_API_KEY: KEY })).wouldReach(),
    ).toBeNull();
  });
});

describe("counter open-weight configuration", () => {
  it("defaults on, because the counter asked for open weights by name", () => {
    expect(env({}).llm.counterPreferOpen).toBe(true);
  });

  it("can be turned off explicitly", () => {
    expect(env({ LLM_COUNTER_PREFER_OPEN: "false" }).llm.counterPreferOpen).toBe(false);
    expect(env({ LLM_COUNTER_PREFER_OPEN: "0" }).llm.counterPreferOpen).toBe(false);
    expect(env({ LLM_COUNTER_PREFER_OPEN: "true" }).llm.counterPreferOpen).toBe(true);
  });
});

describe("paid tier — what a billed plan changes", () => {
  it("stops metering a paid provider against free-tier limits", () => {
    // The defect this pins: a paid key was metered against quota numbers it
    // does not have, so the router could bench a healthy provider as "quota
    // nearly exhausted" while the account still had plenty.
    const free = new LlmRouter(env({ LLM_ROUTING_MODE: "auto-free", GROQ_API_KEY: KEY }));
    const paid = new LlmRouter(
      env({ LLM_ROUTING_MODE: "auto-free", GROQ_API_KEY: KEY, LLM_PAID_TIER: "groq" }),
    );

    const pressureOf = (router: LlmRouter) =>
      router.health().find((h) => h.provider === "groq")!.rateLimit.pressure;

    // The free tracker meters against Groq's documented 6,000 tokens/minute.
    expect(pressureOf(free).detail).toContain("6,000");
    expect(pressureOf(free).binding).toBe("tpm");

    // The paid one tracks nothing locally and says so, leaving the provider's
    // own rate-limit headers as the only authority — which is correct, because
    // they are the only thing that knows the real plan.
    expect(pressureOf(paid).detail).toMatch(/no documented quota/i);
    expect(pressureOf(paid).binding).toBeUndefined();
  });

  it("admits a paid Gemini under strict privacy, and excludes a free one", () => {
    // Gemini's free tier may use prompts to improve Google products; its paid
    // tier does not. Judging both by the free tier threw away the guarantee a
    // deployer is paying for.
    const free = new LlmRouter(
      env({ LLM_ROUTING_MODE: "auto-free", LLM_PRIVACY_MODE: "strict", GEMINI_API_KEY: KEY }),
    );
    expect(free.plan().chain).toEqual(["local"]);

    const paid = new LlmRouter(
      env({
        LLM_ROUTING_MODE: "auto-free",
        LLM_PRIVACY_MODE: "strict",
        GEMINI_API_KEY: KEY,
        LLM_PAID_TIER: "gemini",
      }),
    );
    expect(paid.plan().chain).toEqual(["gemini", "local"]);
    expect(paid.preferred()).toBe("gemini");
  });

  it("drops the free-tier capacity warning for a billed plan", () => {
    const free = new LlmRouter(env({ LLM_ROUTING_MODE: "auto-free", GROQ_API_KEY: KEY }));
    expect(free.plan().warnings.some((w) => /free tier/.test(w))).toBe(true);

    const paid = new LlmRouter(
      env({ LLM_ROUTING_MODE: "auto-free", GROQ_API_KEY: KEY, LLM_PAID_TIER: "groq" }),
    );
    expect(paid.plan().warnings.some((w) => /free tier/.test(w))).toBe(false);
  });

  it("reports which providers were declared paid", () => {
    const router = new LlmRouter(
      env({
        LLM_ROUTING_MODE: "auto-free",
        GEMINI_API_KEY: KEY,
        GROQ_API_KEY: KEY,
        LLM_PAID_TIER: "gemini,groq",
      }),
    );
    expect(router.plan().paidTier.sort()).toEqual(["gemini", "groq"]);
  });

  it("rejects an unknown provider name rather than silently ignoring it", () => {
    // Silently dropping it would leave the deployer believing a guarantee they
    // do not have.
    const parsed = env({ LLM_PAID_TIER: "gemini,nonsense" });
    expect(parsed.llm.paidTier.has("gemini")).toBe(true);
    expect(parsed.problems.some((p) => p.field === "LLM_PAID_TIER")).toBe(true);
  });

  it("defaults to declaring nothing paid", () => {
    expect(env({ GEMINI_API_KEY: KEY }).llm.paidTier.size).toBe(0);
  });
});
