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
import { isSensitiveCounterProfile } from "./profiles";
import { COUNTER_JSON_SCHEMA, COUNTER_SYSTEM_PROMPT, buildCounterPrompt } from "./prompt";
import type { CounterPromptInput } from "./prompt";

/**
 * A counter exchange tolerates more latency than a sermon, but not much more —
 * two people are standing there looking at each other.
 */
export const COUNTER_DEADLINE_MS = 6000;

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
 */
type CounterRoutingInput = CounterPromptInput & { forceSensitiveRouting?: boolean };

function routerForCounter(input: CounterRoutingInput): {
  router: LlmRouter;
  sensitive: boolean;
  policyError?: string;
} {
  const env = appEnv();
  const sensitive =
    !!input.forceSensitiveRouting || isSensitiveCounterProfile(input.profileId);
  if (!sensitive) return { router: llmRouter(), sensitive: false };

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

export async function translateForCounter(
  input: CounterRoutingInput & { routingKey?: string },
): Promise<TranslationResult> {
  const started = Date.now();
  const { router, sensitive, policyError } = routerForCounter(input);

  if (policyError) {
    return { ok: false, latencyMs: Date.now() - started, error: policyError };
  }

  // Open weights first when asked for, but only as an ordering for general
  // sessions. The sensitive router is already hard-pinned to OpenRouter.
  const prefer = appEnv().llm.counterPreferOpen ? OPEN_WEIGHT : undefined;

  // No cloud provider at all. The local interpreter cannot translate arbitrary
  // language pairs, so say so rather than emit something useless.
  if (!router.wouldReach(prefer)) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: sensitive
        ? "민감업무 보호 모드의 허용된 번역 제공자를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."
        : "No translation provider is configured. Counter Mode needs an LLM key — see docs/counter-mode.md.",
    };
  }

  try {
    const result = await router.complete(
      {
        system: COUNTER_SYSTEM_PROMPT,
        user: buildCounterPrompt(input),
        maxOutputTokens: 500,
        // Slightly warmer than the live path: a rephrase that returns the same
        // words is not a rephrase.
        temperature: input.action === "simplify" || input.rephrase ? 0.35 : 0.2,
        jsonSchema: COUNTER_JSON_SCHEMA,
        thinking: "none",
      },
      {
        deadlineMs: COUNTER_DEADLINE_MS,
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
    telemetry.recordFailure(llmError.kind);
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: sensitive
        ? "민감업무 보호 모드에서는 다른 외부 모델로 자동 전환하지 않습니다. 잠시 후 다시 시도해 주세요."
        : llmError.message,
    };
  }
}
