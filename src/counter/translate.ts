/**
 * Counter translation service.
 *
 * General Counter sessions use the shared LLM router and its configured
 * fallback chain. Refugee and judicial/case-processing profiles take a
 * deliberately narrower path: OpenRouter with data_collection=deny only.
 * They never fall through to Google AI Studio or another external provider.
 */
import "server-only";
import { llmRouter } from "@/providers/llm";
import { LlmRouter, OPEN_WEIGHT } from "@/providers/llm/router";
import { appEnv, type AppEnv } from "@/lib/env";
import { parseCounterOutput, type CounterOutput } from "@/lib/schema";
import { toLlmError } from "@/providers/llm/errors";
import { telemetry } from "@/lib/telemetry";
import {
  completeViaVercelGateway,
  vercelGatewayAvailable,
  VERCEL_GATEWAY_MODEL,
} from "@/providers/llm/vercel-gateway";
import { isSensitiveCounterProfile } from "./profiles";
import { COUNTER_JSON_SCHEMA, COUNTER_SYSTEM_PROMPT, buildCounterPrompt } from "./prompt";
import type { CounterPromptInput } from "./prompt";
import { detectRisks } from "./risks";

/**
 * A counter exchange tolerates more latency than a sermon, but not much more —
 * two people are standing there looking at each other.
 */
export const COUNTER_DEADLINE_MS = 6000;

/**
 * Wall-clock budget for the WHOLE turn, every provider and the gateway
 * recovery included.
 *
 * Without it a chain of three configured providers, each allowed the full
 * per-attempt deadline, could keep two people staring at a spinner for
 * eighteen seconds before admitting failure. With it, each later attempt
 * gets only what is left, and an attempt that cannot land in time is skipped
 * so the sender sees "failed, try again" while retrying is still useful.
 */
export const COUNTER_TURN_BUDGET_MS = 10_000;

/** Smallest provider attempt worth starting inside the turn budget. */
export const COUNTER_MIN_ATTEMPT_MS = 1_200;

/**
 * How long the primary route gets before a second route is started in
 * parallel.
 *
 * Measured reality behind this number: the public OpenRouter `:free` pool
 * queues requests, so its median is fine and its tail is several seconds. A
 * hedge turns "wait for the slow tail, then fail over" into "whichever answers
 * first". Only a slow primary pays the second request.
 */
export const COUNTER_HEDGE_MS = 2_200;

/**
 * After the Gateway fails for a non-timeout reason (no credit, auth, a privacy
 * policy no upstream can satisfy) it is skipped for this long, so a
 * misconfigured Gateway does not add a doomed round trip to every turn.
 */
export const COUNTER_GATEWAY_COOLDOWN_MS = 60_000;

/** Model for the Counter's Gateway route. Overridable without a code change. */
export const counterGatewayModel = (): string =>
  process.env.VERCEL_AI_GATEWAY_COUNTER_MODEL?.trim() || VERCEL_GATEWAY_MODEL;

/**
 * `gateway-first` (default): a fast, strong, ZDR-only Gateway model answers
 * ordinary turns, and the configured router chain is the hedge and fallback.
 * `router-first`: the previous behaviour — router chain first, Gateway only as
 * recovery. Sensitive profiles ignore this entirely; they are pinned.
 */
export type CounterRoute = "gateway-first" | "router-first";
export const counterRoute = (): CounterRoute =>
  process.env.COUNTER_TRANSLATION_ROUTE?.trim().toLowerCase() === "router-first"
    ? "router-first"
    : "gateway-first";

let gatewayCooldownUntil = 0;

// Sensitive turns need the same circuit-breaker and quota memory as ordinary
// turns. Recreating this router per request repeatedly probes an unavailable
// provider and makes every turn pay the full outage latency.
let sensitiveRouter: LlmRouter | null = null;

export interface TranslationResult {
  ok: boolean;
  output?: CounterOutput;
  provider?: string;
  model?: string;
  latencyMs: number;
  error?: string;
}

/**
 * Build the router for one Counter turn.
 *
 * Sensitive profiles are pinned to OpenRouter and strict privacy. This is not
 * a preference: it is a hard routing boundary. If OpenRouter is unavailable,
 * the turn fails rather than sending refugee/judicial content to another cloud.
 *
 * `forceSensitiveRouting` is retained as a compatibility field for callers
 * created before profile detection became the policy boundary. It must not turn
 * an ordinary or merely-unclassified conversation into a single-provider
 * session: doing that disables the normal provider fallback chain and makes one
 * vendor/model hiccup look like a language-specific translation outage.
 */
type CounterRoutingInput = CounterPromptInput & {
  forceSensitiveRouting?: boolean;
  /** Request-scoped Vercel OIDC token. Server-only; never copied into prompts or responses. */
  gatewayToken?: string;
};

function routerForCounter(input: CounterRoutingInput): {
  router: LlmRouter;
  sensitive: boolean;
  policyError?: string;
} {
  // Resolve the shared router first. It applies the deliberately narrow public
  // `:free` OpenRouter exception to the cached environment when eligible. A
  // sensitive turn must inspect that same effective environment rather than
  // the pre-router fail-closed snapshot, or the first sensitive message after
  // a cold start incorrectly reports that no protected provider exists.
  const generalRouter = llmRouter();
  const env = appEnv();
  const sensitive = isSensitiveCounterProfile(input.profileId);
  if (!sensitive) return { router: generalRouter, sensitive: false };

  if (
    !env.llm.providers.openrouter.configured ||
    env.llm.openrouter.policy.dataCollection !== "deny"
  ) {
    return {
      router: new LlmRouter(env),
      sensitive: true,
      policyError:
        "민감업무 보호 모드에서는 수집 차단이 설정된 OpenRouter만 사용할 수 있습니다.",
    };
  }

  const sensitiveEnv: AppEnv = {
    ...env,
    llm: {
      ...env.llm,
      routingMode: "pinned",
      pinned: "openrouter",
      privacyMode: "strict",
      allowPaidFallback: false,
    },
  };

  return { router: (sensitiveRouter ??= new LlmRouter(sensitiveEnv)), sensitive: true };
}

/** Test seam. */
export const __resetSensitiveCounterRouter = () => {
  sensitiveRouter = null;
};

/* -------------------------------------------------------------------------- */
/* Translation memory                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Staff repeat themselves. "여권 보여 주세요" is said forty times a day, and the
 * fortieth time should not wait on a model or come out worded differently.
 *
 * Deliberately narrow, because this holds text in server memory:
 *  - staff turns only (never what a visitor said),
 *  - ordinary profiles only (never refugee/judicial),
 *  - short, with no digits and nothing the risk detector flags (no names,
 *    numbers, dates, codes) — so a cached line cannot carry anyone's details,
 *  - only confident, note-free results, and never a simplify/retry action.
 * Per instance, bounded, and expiring; losing it costs one model call.
 */
const MEMORY_MAX_ENTRIES = 400;
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
const MEMORY_MAX_CHARS = 80;
const memory = new Map<string, { output: CounterOutput; model?: string; at: number }>();

const normaliseForMemory = (text: string) =>
  text.normalize("NFC").trim().replace(/\s+/g, " ");

function memoryKey(input: CounterRoutingInput, sensitive: boolean): string | null {
  if (sensitive || input.from !== "host" || input.action || input.rephrase) return null;
  const text = normaliseForMemory(input.text);
  if (!text || text.length > MEMORY_MAX_CHARS) return null;
  if (/\p{Nd}/u.test(text) || detectRisks(text).length > 0) return null;
  return JSON.stringify([
    input.sourceLang.toLowerCase(),
    input.targetLang.toLowerCase(),
    input.profileId ?? "general",
    text,
  ]);
}

function recall(key: string | null, now: number) {
  if (!key) return null;
  const hit = memory.get(key);
  if (!hit) return null;
  if (now - hit.at > MEMORY_TTL_MS) {
    memory.delete(key);
    return null;
  }
  // Refresh recency: Map iteration order is insertion order.
  memory.delete(key);
  memory.set(key, hit);
  return hit;
}

function remember(key: string | null, result: TranslationResult, now: number) {
  if (!key || !result.ok || !result.output) return;
  if (result.output.confidence !== "high" || result.output.note?.trim()) return;
  memory.set(key, { output: result.output, model: result.model, at: now });
  while (memory.size > MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/** Test seam. */
export const __resetCounterTranslationState = () => {
  memory.clear();
  gatewayCooldownUntil = 0;
  sensitiveRouter = null;
};

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

const temperatureFor = (input: CounterRoutingInput) =>
  input.action === "simplify" || input.rephrase ? 0.35 : 0.2;

const isAbort = (error: unknown) =>
  error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message));

async function translateViaGateway(
  input: CounterRoutingInput,
  started: number,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  const model = counterGatewayModel();
  const remaining = COUNTER_TURN_BUDGET_MS - (Date.now() - started);
  if (remaining < COUNTER_MIN_ATTEMPT_MS) {
    return {
      ok: false,
      provider: "vercel-gateway",
      model,
      latencyMs: Date.now() - started,
      error: "Translation took too long. Please try again.",
    };
  }
  try {
    const response = await completeViaVercelGateway(
      {
        system: COUNTER_SYSTEM_PROMPT,
        user: buildCounterPrompt(input),
        maxOutputTokens: 500,
        temperature: temperatureFor(input),
        jsonSchema: COUNTER_JSON_SCHEMA,
        thinking: "none",
        signal,
      },
      { timeoutMs: Math.min(COUNTER_DEADLINE_MS, remaining), token: input.gatewayToken, model },
    );

    const output = parseCounterOutput(response.text);
    telemetry.recordSchemaResult(output !== null);
    if (!output) {
      return {
        ok: false,
        provider: "vercel-gateway",
        model: response.model ?? model,
        latencyMs: Date.now() - started,
        error: "The Vercel Gateway translation did not match the required schema.",
      };
    }

    telemetry.recordLatency({
      stage: "provider_response",
      ms: response.latencyMs,
      provider: "vercel-gateway",
      model: response.model ?? model,
    });

    if (!output.translation.trim()) {
      return {
        ok: false,
        provider: "vercel-gateway",
        model: response.model ?? model,
        latencyMs: Date.now() - started,
        error: output.note || "Nothing intelligible to translate.",
      };
    }

    return {
      ok: true,
      output,
      provider: "vercel-gateway",
      model: response.model ?? model,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    const llmError = toLlmError(error);
    if (!signal?.aborted) {
      telemetry.recordFailure(llmError.kind);
      // A timeout says the Gateway is slow right now; anything else (credit,
      // auth, policy) will fail the next turn identically, so stop asking.
      if (llmError.kind !== "timeout" && !isAbort(error)) {
        gatewayCooldownUntil = Date.now() + COUNTER_GATEWAY_COOLDOWN_MS;
      }
    }
    return {
      ok: false,
      provider: "vercel-gateway",
      model,
      latencyMs: Date.now() - started,
      error: llmError.message,
    };
  }
}

/**
 * The configured router chain as one attempt. Never throws.
 *
 * `gatewayRecovery` keeps the old behaviour for router-first: the Gateway is
 * tried once when the chain fails. In gateway-first mode the Gateway already
 * ran, so it is off.
 */
async function translateViaRouter(
  input: CounterRoutingInput & { routingKey?: string },
  started: number,
  router: LlmRouter,
  sensitive: boolean,
  options: { gatewayRecovery: boolean; signal?: AbortSignal },
): Promise<TranslationResult> {
  const recover = () =>
    options.gatewayRecovery && !sensitive && vercelGatewayAvailable(input.gatewayToken);
  const prefer = sensitive ? undefined : appEnv().llm.counterPreferOpen ? OPEN_WEIGHT : undefined;

  try {
    const result = await router.complete(
      {
        system: COUNTER_SYSTEM_PROMPT,
        user: buildCounterPrompt(input),
        maxOutputTokens: 500,
        // Slightly warmer than the live path: a rephrase that returns the same
        // words is not a rephrase.
        temperature: temperatureFor(input),
        jsonSchema: COUNTER_JSON_SCHEMA,
        thinking: "none",
        signal: options.signal,
      },
      {
        deadlineMs: COUNTER_DEADLINE_MS,
        turnDeadlineMs: Math.max(
          COUNTER_MIN_ATTEMPT_MS,
          COUNTER_TURN_BUDGET_MS - (Date.now() - started),
        ),
        minAttemptMs: COUNTER_MIN_ATTEMPT_MS,
        validate: (response) => parseCounterOutput(response.text) !== null,
        prefer,
        routingKey: input.routingKey,
      },
    );

    // A sensitive request must never report that it reached a second cloud
    // provider. This assertion is intentionally redundant with the pinned
    // router so a future routing refactor fails closed rather than leaking.
    if (sensitive && result.provider !== "openrouter") {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: "민감업무 보호 정책에 따라 번역을 중단했습니다.",
      };
    }

    const output = parseCounterOutput(result.response.text);
    telemetry.recordSchemaResult(output !== null);

    if (!output) {
      if (recover()) return translateViaGateway(input, started, options.signal);
      return {
        ok: false,
        provider: result.provider,
        model: result.model,
        latencyMs: Date.now() - started,
        error: "The translation model returned output that did not match the schema.",
      };
    }

    telemetry.recordLatency({
      stage: "provider_response",
      ms: result.response.latencyMs,
      provider: result.provider,
      model: result.model,
    });

    if (!output.translation.trim()) {
      if (recover()) return translateViaGateway(input, started, options.signal);
      return {
        ok: false,
        provider: result.provider,
        model: result.model,
        latencyMs: Date.now() - started,
        error: output.note || "Nothing intelligible to translate.",
      };
    }

    return {
      ok: true,
      output,
      provider: result.provider,
      model: result.model,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    const llmError = toLlmError(error);
    if (!options.signal?.aborted) telemetry.recordFailure(llmError.kind);

    if (recover()) {
      const recovered = await translateViaGateway(input, started, options.signal);
      if (recovered.ok) return recovered;
    }

    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: sensitive
        ? "민감업무 보호 모드에서는 다른 외부 모델로 자동 전환하지 않습니다. 잠시 후 다시 시도해 주세요."
        : llmError.message,
    };
  }
}

/**
 * Gateway first, router chain as hedge and fallback.
 *
 * The Gateway starts immediately. If it fails, the router starts at once. If
 * it is merely slow, the router starts at COUNTER_HEDGE_MS and the first good
 * answer wins; the loser is aborted. Two requests are only ever in flight for
 * a turn whose primary is already late.
 */
async function hedgedTranslate(
  input: CounterRoutingInput & { routingKey?: string },
  started: number,
  router: LlmRouter,
  routerReachable: boolean,
): Promise<TranslationResult> {
  const gatewayAbort = new AbortController();
  const routerAbort = new AbortController();
  const gateway = translateViaGateway(input, started, gatewayAbort.signal);
  if (!routerReachable) return gateway;

  let routerRun: Promise<TranslationResult> | null = null;
  const startRouter = () =>
    (routerRun ??= translateViaRouter(input, started, router, false, {
      gatewayRecovery: false,
      signal: routerAbort.signal,
    }));

  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  const hedge = new Promise<"hedge">((resolve) => {
    hedgeTimer = setTimeout(() => resolve("hedge"), COUNTER_HEDGE_MS);
  });

  try {
    const first = await Promise.race([gateway, hedge]);
    if (first !== "hedge") {
      if (first.ok) return first;
      return await startRouter();
    }

    // The Gateway is late: race it against the router; first success wins.
    const routerResult = startRouter();
    const winner = await new Promise<TranslationResult>((resolve) => {
      let pending = 2;
      let lastFailure: TranslationResult | null = null;
      for (const run of [gateway, routerResult]) {
        void run.then((result) => {
          pending -= 1;
          if (result.ok) resolve(result);
          else {
            // Prefer the router's message: it names the configured provider.
            if (!lastFailure || run === routerResult) lastFailure = result;
            if (pending === 0) resolve(lastFailure!);
          }
        });
      }
    });
    if (winner.ok) {
      if (winner.provider === "vercel-gateway") routerAbort.abort();
      else gatewayAbort.abort();
    }
    return winner;
  } finally {
    clearTimeout(hedgeTimer);
  }
}

export async function translateForCounter(
  input: CounterRoutingInput & { routingKey?: string },
): Promise<TranslationResult> {
  const started = Date.now();
  const { router, sensitive, policyError } = routerForCounter(input);

  if (policyError) {
    return { ok: false, latencyMs: Date.now() - started, error: policyError };
  }

  const key = memoryKey(input, sensitive);
  const cached = recall(key, started);
  if (cached) {
    telemetry.recordLatency({ stage: "counter_memory_hit", ms: Date.now() - started });
    return {
      ok: true,
      output: cached.output,
      provider: "memory",
      model: cached.model,
      latencyMs: Date.now() - started,
    };
  }

  // Open weights first when asked for, but only as an ordering for general
  // sessions. The sensitive router is already hard-pinned to OpenRouter.
  const prefer = appEnv().llm.counterPreferOpen ? OPEN_WEIGHT : undefined;
  const routedCloud = router.wouldReach(sensitive ? undefined : prefer);
  const gatewayReady =
    !sensitive &&
    vercelGatewayAvailable(input.gatewayToken) &&
    Date.now() >= gatewayCooldownUntil;

  let result: TranslationResult;
  if (sensitive) {
    // Sensitive profiles remain hard-pinned to the explicitly protected
    // OpenRouter path. The Gateway cannot weaken that policy boundary.
    result = routedCloud
      ? await translateViaRouter(input, started, router, true, { gatewayRecovery: false })
      : {
          ok: false,
          latencyMs: Date.now() - started,
          error:
            "민감업무 보호 모드의 허용된 번역 제공자를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        };
  } else if (gatewayReady && counterRoute() === "gateway-first") {
    result = await hedgedTranslate(input, started, router, !!routedCloud);
  } else if (routedCloud) {
    result = await translateViaRouter(input, started, router, false, {
      gatewayRecovery: vercelGatewayAvailable(input.gatewayToken),
    });
  } else if (vercelGatewayAvailable(input.gatewayToken)) {
    result = await translateViaGateway(input, started);
  } else {
    result = {
      ok: false,
      latencyMs: Date.now() - started,
      error: "No translation provider is configured. Counter Mode needs an LLM provider.",
    };
  }

  remember(key, result, Date.now());
  return result;
}

