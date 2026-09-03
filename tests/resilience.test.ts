/**
 * Provider-failure resilience — Phase 2 acceptance scenario C.
 *
 * The requirement being tested: when the primary free provider starts returning
 * 429 during a live sermon, the Korean transcript keeps running, the console
 * does not blank, the router moves on, the failed provider goes into cooldown,
 * and a stale answer does not arrive later and overwrite good English.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InterpretationEngine, __resetSegmentIds, type EngineSnapshot } from "@/interpreter/engine/session";
import { __resetChunkIds } from "@/interpreter/engine/chunks";
import { LlmRouter } from "@/providers/llm/router";
import { LlmError } from "@/providers/llm/errors";
import { parseEnv } from "@/lib/env";
import { interpretLocally } from "@/providers/llm/mock";
import type { InterpretRequest } from "@/lib/schema";

const KEY = "x".repeat(24);
const VALID = JSON.stringify({
  safeChunks: [{ text: "Today we're going to look at...", confidence: "high" }],
  confidence: "high",
});

/** Router with stubbed provider instances, so no network is involved. */
function routerWith(
  behaviours: Record<string, () => Promise<{ text: string; latencyMs: number }>>,
  vars: Record<string, string>,
  now?: () => number,
) {
  const router = new LlmRouter(parseEnv(vars as unknown as NodeJS.ProcessEnv), now);
  const original = (router as unknown as { instanceFor: (id: string) => unknown }).instanceFor;
  (router as unknown as { instanceFor: (id: string) => unknown }).instanceFor = function (id: string) {
    const behaviour = behaviours[id];
    return behaviour ? { id, model: `${id}-model`, complete: behaviour } : original.call(this, id);
  };
  return router;
}

beforeEach(() => {
  __resetChunkIds();
  __resetSegmentIds();
});

describe("scenario C · primary free provider returns 429 mid-sermon", () => {
  it("keeps interpreting via the fallback and never blanks the console", async () => {
    let geminiCalls = 0;
    const router = routerWith(
      {
        gemini: async () => {
          geminiCalls += 1;
          throw new LlmError("rate limit exceeded", "rate_limited", 429);
        },
        groq: async () => ({ text: VALID, latencyMs: 40 }),
      },
      { LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY },
    );

    let now = 0;
    let snapshot: EngineSnapshot | null = null;
    const engine = new InterpretationEngine({
      mode: "sermon",
      lag: "balanced",
      now: () => now,
      onChange: (next) => {
        snapshot = next;
      },
      interpret: async (request: InterpretRequest) => {
        const result = await router.complete(
          { system: "DOMAIN: KOREAN CHURCH SERMON", user: `KOREAN TO INTERPRET NOW (stabilised):\n${request.pending}` },
          { deadlineMs: 3000 },
        );
        return {
          output: JSON.parse(result.response.text),
          degraded: result.degraded,
          reason: result.reason,
        };
      },
    });

    engine.start();

    for (let turn = 0; turn < 6; turn += 1) {
      engine.handleStable("우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.");
      now += 3000;
      engine.tick();
      await vi.waitFor(() => expect(snapshot?.thinking).toBe(false), { timeout: 1000 });
    }

    const state = snapshot as unknown as EngineSnapshot;

    // 1. Korean transcript kept running.
    expect(state.segments).toHaveLength(6);
    // 2. English kept appearing — the console never blanked.
    expect(state.chunks.length).toBeGreaterThan(0);
    // 3. Scripture detection is local, so it survived regardless.
    expect(state.scripture.map((r) => r.display)).toContain("1 Peter 2:9");
    // 5. The failed provider went into cooldown rather than being retried on
    //    every phrase for the rest of the service.
    expect(geminiCalls).toBeLessThanOrEqual(3);

    // What matters is that the router stopped sending it live turns — whether
    // that came from the breaker or from quota pressure is an implementation
    // detail, and both are legitimate reasons.
    const health = router.health().find((h) => h.provider === "gemini")!;
    expect(health.eligible).toBe(false);
    expect(health.ineligibleReason).toBeTruthy();
  });

  it("reaches the local interpreter when every provider is rate-limited", async () => {
    const router = routerWith(
      {
        gemini: async () => {
          throw new LlmError("quota exceeded", "quota_exhausted", 429);
        },
        groq: async () => {
          throw new LlmError("rate limit", "rate_limited", 429);
        },
      },
      { LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY },
    );

    const result = await router.complete(
      {
        system: "DOMAIN: KOREAN CHURCH SERMON",
        user: "KOREAN TO INTERPRET NOW (stabilised):\n우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.",
      },
      { deadlineMs: 3000 },
    );

    expect(result.provider).toBe("local");
    // Even the floor still normalises Scripture.
    const output = JSON.parse(result.response.text);
    expect(output.bibleReferences?.[0]?.display).toBe("1 Peter 2:9");
  });

  it("recovers after the cooldown expires", async () => {
    let failing = true;
    let now = 0;
    const router = routerWith(
      {
        gemini: async () => {
          if (failing) throw new LlmError("rate limit", "rate_limited", 429);
          return { text: VALID, latencyMs: 30 };
        },
      },
      { LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY },
      () => now,
    );

    for (let i = 0; i < 3; i += 1) {
      await router.complete({ system: "s", user: "u" }, { deadlineMs: 1000 });
    }
    expect(router.health().find((h) => h.provider === "gemini")!.eligible).toBe(false);

    failing = false;
    // Past both the breaker cooldown and the 5-minute 429 pressure window.
    now += 6 * 60_000;

    const result = await router.complete({ system: "s", user: "u" }, { deadlineMs: 1000 });
    expect(result.provider).toBe("gemini");
  });

  it("stops the fallback chain when newer speech supersedes the whole turn", async () => {
    // A slow request is aborted when newer Korean supersedes it; the engine
    // must not apply what it eventually returns.
    const controller = new AbortController();
    const router = routerWith(
      {
        gemini: async () =>
          new Promise((_resolve, reject) => {
            controller.signal.addEventListener("abort", () =>
              reject(new LlmError("Superseded by newer speech.", "timeout")),
            );
          }),
      },
      { LLM_ROUTING_MODE: "auto-free", GEMINI_API_KEY: KEY },
    );

    const pending = router.complete(
      { system: "DOMAIN: KOREAN CHURCH SERMON", user: "KOREAN TO INTERPRET NOW (stabilised):\n안녕하세요.", signal: controller.signal },
      { deadlineMs: 5000 },
    );
    controller.abort();

    // A caller abort means the whole result is obsolete. It must neither hang
    // nor spend another provider/local attempt on stale Korean.
    await expect(pending).rejects.toMatchObject({ kind: "timeout" });
  });
});

describe("rate-limit simulation", () => {
  it("stops routing to a provider once its daily cap is spent", async () => {
    const router = routerWith(
      { openrouter: async () => ({ text: VALID, latencyMs: 20 }) },
      { LLM_ROUTING_MODE: "auto-free", OPENROUTER_API_KEY: KEY },
    );

    // OpenRouter's unfunded free tier is 50 requests/day: about four minutes of
    // continuous speech. Burn it and confirm the router notices.
    for (let i = 0; i < 50; i += 1) {
      await router.complete({ system: "s", user: "u" }, { deadlineMs: 1000, estimatedTokens: 2700 });
    }

    const health = router.health().find((h) => h.provider === "openrouter")!;
    expect(health.rateLimit.pressure.level).toBeGreaterThanOrEqual(0.9);
    expect(health.eligible).toBe(false);

    // And the session keeps working.
    const result = await router.complete(
      { system: "DOMAIN: KOREAN CHURCH SERMON", user: "KOREAN TO INTERPRET NOW (stabilised):\n안녕하세요." },
      { deadlineMs: 1000 },
    );
    expect(result.provider).toBe("local");
  });

  it("degrades the context profile as quota pressure rises", async () => {
    const { chooseProfile } = await import("@/interpreter/context/profiles");
    expect(chooseProfile({ recommendedLiveTokens: 4000, quotaPressure: 0, lag: "balanced" }).profile).toBe("full");
    expect(chooseProfile({ recommendedLiveTokens: 4000, quotaPressure: 0.7, lag: "balanced" }).profile).toBe("compact");
    expect(chooseProfile({ recommendedLiveTokens: 4000, quotaPressure: 0.95, lag: "balanced" }).profile).toBe("ultra-compact");
  });

  it("gives a low-TPM provider a compact profile from the start", async () => {
    const { chooseProfile } = await import("@/interpreter/context/profiles");
    const { capabilitiesFor } = await import("@/providers/llm/capabilities");
    const groq = capabilitiesFor("groq");
    const decision = chooseProfile({
      recommendedLiveTokens: groq.recommendedLiveContextTokens,
      quotaPressure: 0,
      lag: "balanced",
    });
    expect(decision.profile).not.toBe("full");
  });
});

describe("the local floor always answers", () => {
  it("normalises Scripture with no provider at all", () => {
    const output = interpretLocally({
      pending: "우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.",
      mode: "sermon",
    });
    expect(output.bibleReferences?.[0]?.display).toBe("1 Peter 2:9");
  });

  it("still adapts the wordplay acceptance case", () => {
    const output = interpretLocally({
      pending: "그래서 우리는 길을 잘 찾아야 됩니다. 제 이름에도 길이 있어요.",
      mode: "sermon",
    });
    const english = output.safeChunks.map((c) => c.text).join(" ").toLowerCase();
    expect(english).not.toContain("road in my name");
  });
});
