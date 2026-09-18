/**
 * The live failure hierarchy, asserted end to end through the router.
 *
 * "The LLM sometimes does not run at all" is not one bug, it is a family of
 * them, and each member has its own correct answer:
 *
 *   primary succeeds        → use it, and stay on it
 *   primary times out       → next provider, inside what is left of the turn
 *   primary out of quota    → next provider
 *   primary returns rubbish → next provider (schema failure IS a failure)
 *   everything configured is dead → the recovery route
 *   no recovery route either      → the deterministic floor, labelled
 *
 * The rule that ties them together is that the chain has a wall-clock budget.
 * Three providers each allowed their own deadline answer twelve seconds late,
 * which for simultaneous interpretation is the same as not answering at all —
 * and costs three times the money to do it.
 */
import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/lib/env";
import { LlmError } from "./errors";
import { LlmRouter, MIN_USEFUL_ATTEMPT_MS, type RouteRecovery } from "./router";
import type { LlmProviderId, LlmRequest, LlmResponse } from "./types";

const OUTPUT = JSON.stringify({
  safeChunks: [{ text: "We should love one another.", confidence: "high" }],
  confidence: "high",
});

const request: LlmRequest = { system: "s", user: "u" };

/**
 * A router whose providers are scripted.
 *
 * `createProvider` is not injectable, so the instance cache is seeded directly.
 * That is the seam the router already relies on to pin a model for a session,
 * and using it here keeps the routing rules under test rather than a factory.
 */
const KEY = "x".repeat(24);

/** Only the providers a test scripts are configured, so the chain is exact. */
const KEY_FOR: Partial<Record<LlmProviderId, string>> = {
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

function router(
  behaviour: Partial<Record<LlmProviderId, () => Promise<LlmResponse>>>,
  options: { now?: () => number } = {},
) {
  const vars: Record<string, string> = { LLM_ROUTING_MODE: "auto-free" };
  for (const id of Object.keys(behaviour) as LlmProviderId[]) {
    const field = KEY_FOR[id];
    if (field) vars[field] = KEY;
  }
  const env = parseEnv(vars as unknown as NodeJS.ProcessEnv);

  const instance = new LlmRouter(env, options.now);
  const cache = (instance as unknown as { instances: Map<LlmProviderId, unknown> }).instances;
  const calls: LlmProviderId[] = [];
  for (const [id, behave] of Object.entries(behaviour) as Array<
    [LlmProviderId, () => Promise<LlmResponse>]
  >) {
    cache.set(id, {
      id,
      model: `${id}-model`,
      complete: async () => {
        calls.push(id);
        return behave();
      },
    });
  }
  return { instance, calls };
}

const answers = (text = OUTPUT, latencyMs = 40) => async (): Promise<LlmResponse> => ({
  text,
  latencyMs,
});

const fails = (error: LlmError) => async (): Promise<LlmResponse> => {
  throw error;
};

const validate = (response: LlmResponse) => {
  try {
    return Array.isArray(JSON.parse(response.text).safeChunks);
  } catch {
    return false;
  }
};

describe("the ordinary path", () => {
  it("uses the preferred provider and sticks to it", async () => {
    const { instance, calls } = router({ gemini: answers(), groq: answers() });
    const first = await instance.complete(request, { deadlineMs: 3_000, routingKey: "live:a" });
    expect(first.provider).toBe("gemini");
    expect(first.degraded).toBe(false);

    await instance.complete(request, { deadlineMs: 3_000, routingKey: "live:a" });
    // Model roulette between sentences costs terminology and register, which
    // an interpreter notices and cannot correct for.
    expect(calls).toEqual(["gemini", "gemini"]);
  });
});

describe("one provider at a time failing", () => {
  it("moves on after a timeout", async () => {
    const { instance } = router({
      gemini: fails(new LlmError("slow", "timeout")),
      groq: answers(),
    });
    const result = await instance.complete(request, { deadlineMs: 3_000 });
    expect(result.provider).toBe("groq");
    expect(result.degraded).toBe(true);
    expect(result.attempts.map((a) => a.failureKind)).toEqual(["timeout", undefined]);
  });

  it("moves on when the free allowance is spent", async () => {
    const { instance } = router({
      gemini: fails(new LlmError("out of requests today", "quota_exhausted")),
      groq: answers(),
    });
    const result = await instance.complete(request, { deadlineMs: 3_000 });
    expect(result.provider).toBe("groq");
  });

  it("treats malformed output as a provider failure, not as an answer", async () => {
    const { instance } = router({
      gemini: answers("I'm afraid I can't do that."),
      groq: answers(),
    });
    const result = await instance.complete(request, { deadlineMs: 3_000, validate });
    expect(result.provider).toBe("groq");
    expect(result.attempts[0].failureKind).toBe("malformed_output");
  });

  it("drops a provider from the sticky slot the moment it fails", async () => {
    const { instance, calls } = router({
      gemini: fails(new LlmError("boom", "server_error")),
      groq: answers(),
    });
    await instance.complete(request, { deadlineMs: 3_000, routingKey: "live:b" });
    await instance.complete(request, { deadlineMs: 3_000, routingKey: "live:b" });
    expect(calls.filter((id) => id === "groq")).toHaveLength(2);
  });
});

describe("the turn budget", () => {
  it("does not start an attempt that cannot land in time", async () => {
    let now = 0;
    const { instance, calls } = router(
      {
        // Burns almost the whole turn, then fails.
        gemini: async () => {
          now += 2_900;
          throw new LlmError("slow", "timeout");
        },
        groq: answers(),
      },
      { now: () => now },
    );

    const result = await instance.complete(request, {
      deadlineMs: 3_000,
      turnDeadlineMs: 3_000,
    });

    // Groq is never asked: there is no budget in which its answer could still
    // be read. The deterministic floor takes the turn instead, immediately.
    expect(calls).toEqual(["gemini"]);
    expect(result.provider).toBe("local");
    expect(result.attempts.map((a) => [a.provider, a.failureKind])).toEqual([
      ["gemini", "timeout"],
      ["groq", "deadline"],
      ["local", undefined],
    ]);
  });

  it("still tries the next provider while there is useful budget", async () => {
    let now = 0;
    const { instance, calls } = router(
      {
        gemini: async () => {
          now += 500;
          throw new LlmError("slow", "timeout");
        },
        groq: answers(),
      },
      { now: () => now },
    );
    const result = await instance.complete(request, {
      deadlineMs: 3_000,
      turnDeadlineMs: 5_000,
    });
    expect(calls).toEqual(["gemini", "groq"]);
    expect(result.provider).toBe("groq");
  });

  it("shrinks an attempt's deadline to what is left rather than its own", async () => {
    let now = 0;
    const seen: number[] = [];
    const { instance } = router(
      {
        gemini: async () => {
          now += 2_000;
          throw new LlmError("slow", "timeout");
        },
        groq: async () => {
          // The remaining budget, observed through the abort timer the router
          // installs, is what bounds this attempt.
          seen.push(now);
          return { text: OUTPUT, latencyMs: 10 };
        },
      },
      { now: () => now },
    );
    await instance.complete(request, { deadlineMs: 3_000, turnDeadlineMs: 3_000 + MIN_USEFUL_ATTEMPT_MS });
    expect(seen).toHaveLength(1);
  });

  it("leaves behaviour unchanged when the caller sets no budget", async () => {
    const { instance, calls } = router({
      gemini: fails(new LlmError("slow", "timeout")),
      groq: answers(),
    });
    await instance.complete(request, { deadlineMs: 3_000 });
    expect(calls).toEqual(["gemini", "groq"]);
  });
});

describe("the recovery route", () => {
  const recovery = (behave: () => Promise<LlmResponse>): RouteRecovery => ({
    id: "vercel-gateway",
    available: () => true,
    complete: behave,
  });

  it("answers when every configured provider is dead", async () => {
    const { instance } = router({
      gemini: fails(new LlmError("401", "auth")),
      groq: fails(new LlmError("no credits", "quota_exhausted")),
      openrouter: fails(new LlmError("no credits", "quota_exhausted")),
    });
    const result = await instance.complete(request, {
      deadlineMs: 3_000,
      recovery: recovery(async () => ({ text: OUTPUT, model: "gateway-model", latencyMs: 90 })),
    });

    expect(result.via).toBe("vercel-gateway");
    expect(result.model).toBe("gateway-model");
    expect(result.degraded).toBe(true);
    expect(result.attempts.at(-1)?.provider).toBe("vercel-gateway");
  });

  it("is never preferred while a configured provider still works", async () => {
    const gateway = vi.fn(async () => ({ text: OUTPUT, latencyMs: 10 }));
    const { instance } = router({ gemini: answers() });
    const result = await instance.complete(request, {
      deadlineMs: 3_000,
      recovery: recovery(gateway),
    });
    expect(result.provider).toBe("gemini");
    expect(result.via).toBeUndefined();
    expect(gateway).not.toHaveBeenCalled();
  });

  it("is held to the same schema contract as a provider", async () => {
    const { instance } = router({ gemini: fails(new LlmError("401", "auth")) });
    const result = await instance.complete(request, {
      deadlineMs: 3_000,
      validate,
      recovery: recovery(answers("not json at all")),
    });
    // A recovery route that answers with rubbish has not recovered anything.
    expect(result.provider).toBe("local");
    expect(result.attempts.at(-2)?.failureKind).toBe("malformed_output");
  });

  it("falls to the deterministic floor when it fails too", async () => {
    const { instance } = router({ gemini: fails(new LlmError("401", "auth")) });
    const result = await instance.complete(request, {
      deadlineMs: 3_000,
      recovery: recovery(fails(new LlmError("gateway down", "server_error"))),
    });
    expect(result.provider).toBe("local");
    expect(result.model).toBe("deterministic");
    expect(result.degraded).toBe(true);
  });

  it("is skipped, not attempted, once the turn is spent", async () => {
    let now = 0;
    const gateway = vi.fn(async () => ({ text: OUTPUT, latencyMs: 10 }));
    const { instance } = router(
      {
        gemini: async () => {
          now += 2_900;
          throw new LlmError("slow", "timeout");
        },
      },
      { now: () => now },
    );
    const result = await instance.complete(request, {
      deadlineMs: 3_000,
      turnDeadlineMs: 3_000,
      recovery: recovery(gateway),
    });
    expect(gateway).not.toHaveBeenCalled();
    expect(result.provider).toBe("local");
  });
});

describe("no cloud route of any kind", () => {
  it("answers deterministically and says so", async () => {
    const instance = new LlmRouter(parseEnv({} as NodeJS.ProcessEnv));
    const result = await instance.complete(request, { deadlineMs: 3_000 });
    // Never silence: there is no configuration in which the console stops
    // producing English because a vendor had a bad day.
    expect(result.provider).toBe("local");
    expect(result.degraded).toBe(true);
    expect(result.response.text.length).toBeGreaterThan(0);
  });
});
