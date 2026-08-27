/**
 * Counter translation service.
 *
 * Sits on the existing LLM router, so it inherits the circuit breaker, the
 * fallback chain and the rate-limit awareness for free. Two things differ from
 * the live interpretation path:
 *
 *  1. **Open-weight preference.** Counter Mode defaults to providers serving
 *     open-weight models, which is both the stated requirement and — with Groq
 *     — the best privacy posture available on a free tier.
 *  2. **A more forgiving deadline.** Turn-taking at a counter tolerates a few
 *     seconds in a way simultaneous interpretation never can.
 *
 * There is no local fallback that can translate. When every provider fails the
 * message is marked `failed` and the UI says so plainly, because a counter is
 * exactly the wrong place to silently show something that is not a translation.
 */
import "server-only";
import { llmRouter } from "@/providers/llm";
import { OPEN_WEIGHT } from "@/providers/llm/router";
import { appEnv } from "@/lib/env";
import { parseCounterOutput, type CounterOutput } from "@/lib/schema";
import { toLlmError } from "@/providers/llm/errors";
import { telemetry } from "@/lib/telemetry";
import { COUNTER_JSON_SCHEMA, COUNTER_SYSTEM_PROMPT, buildCounterPrompt } from "./prompt";
import type { CounterPromptInput } from "./prompt";

/**
 * A counter exchange tolerates more latency than a sermon, but not much more —
 * two people are standing there looking at each other.
 */
export const COUNTER_DEADLINE_MS = 6000;

export interface TranslationResult {
  ok: boolean;
  output?: CounterOutput;
  provider?: string;
  model?: string;
  latencyMs: number;
  error?: string;
}

export async function translateForCounter(
  input: CounterPromptInput,
): Promise<TranslationResult> {
  const started = Date.now();
  const router = llmRouter();

  // Open weights first when asked for, but only as an ordering. If no
  // open-weight provider is configured the request still goes out: a visitor
  // at a counter needs an answer more than they need a particular licence.
  const prefer = appEnv().llm.counterPreferOpen ? OPEN_WEIGHT : undefined;

  // No cloud provider at all. The local interpreter cannot translate arbitrary
  // language pairs, so say so rather than emit something useless.
  //
  // Asked of the same chain `complete` will walk, `prefer` included, so this
  // check and the request that follows can never disagree about whether a
  // translation was possible.
  if (!router.wouldReach(prefer)) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error:
        "No translation provider is configured. Counter Mode needs an LLM key — see docs/counter-mode.md.",
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
        temperature: input.rephrase ? 0.5 : 0.2,
        jsonSchema: COUNTER_JSON_SCHEMA,
        thinking: "none",
      },
      {
        deadlineMs: COUNTER_DEADLINE_MS,
        validate: (response) => parseCounterOutput(response.text) !== null,
        prefer,
      },
    );

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

    // An empty translation is a legitimate answer for unintelligible input, but
    // it is not something to show as if it were a translation.
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
      error: llmError.message,
    };
  }
}
