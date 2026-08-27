/**
 * POST /api/interpret — the live interpretation endpoint.
 *
 * Runs on the server so provider keys never reach the browser. Three
 * invariants, all of them load-bearing:
 *
 *  1. **It always answers with a valid `InterpreterOutput`.** Every vendor
 *     failure path ends at the deterministic local interpreter.
 *  2. **It never blocks the console.** The deadline comes from the lag profile
 *     the interpreter chose, not from a fixed twelve seconds.
 *  3. **Zod is the trust boundary.** A provider's JSON mode is a hint; schema
 *     validation is the contract, and failing it is a provider failure that
 *     moves the router on to the next candidate.
 *  4. **It is not free to abuse.** This route spends the deployer's money on
 *     every call. It is same-origin, session-bound, body-capped and rate
 *     limited before a provider is ever reached. See `src/lib/guard.ts`.
 */
import { NextResponse } from "next/server";
import { interpretRequestSchema, interpreterOutputSchema, parseInterpreterOutput } from "@/lib/schema";
import { buildLiveUserPrompt, systemPromptFor } from "@/interpreter/prompts/live";
import { INTERPRETER_JSON_SCHEMA } from "@/interpreter/prompts/json-schema";
import { applyProfile, chooseProfile } from "@/interpreter/context/profiles";
import { capabilitiesFor, deadlineFor, llmRouter, turnBudgetFor } from "@/providers/llm";
import { interpretLocally } from "@/providers/llm/mock";
import { estimateTokens, telemetry } from "@/lib/telemetry";
import { guardInferenceRoute } from "@/lib/guard";
import { escalationDecision, escalationImproves } from "@/providers/llm/escalation";
import { createQualityProvider } from "@/providers/llm/factory";
import { appEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ceiling on one live request body.
 *
 * The schema already bounds every field; this bounds the bytes before parsing,
 * so an oversized payload is refused without being read into memory or
 * validated.
 */
const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: Request) {
  const receivedAt = Date.now();

  const guarded = await guardInferenceRoute(request, {
    requireSession: true,
    maxBodyBytes: MAX_BODY_BYTES,
    limits: [
      { rule: "interpretSession", by: "session" },
      { rule: "interpretAddress", by: "address" },
    ],
  });
  if (!guarded.ok) return guarded.response;

  const parsed = interpretRequestSchema.safeParse(guarded.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const router = llmRouter();

  const localOutput = () =>
    interpretLocally({
      pending: input.pending,
      mode: input.mode,
      allowAnticipation: input.allowAnticipation,
    });

  const preferred = router.preferred();

  // No cloud candidate at all: answer locally without pretending otherwise.
  if (!preferred || preferred === "local") {
    return NextResponse.json({
      output: localOutput(),
      provider: "local",
      model: "deterministic",
      degraded: true,
      reason: "No cloud interpretation provider is available — using the local interpreter.",
      profile: "full",
    });
  }

  /* --- Context budgeting ------------------------------------------------ */
  const caps = capabilitiesFor(preferred);
  const decision = chooseProfile({
    recommendedLiveTokens: caps.recommendedLiveContextTokens,
    quotaPressure: router.pressureFor(preferred),
    latencyP95Ms: telemetry.stage("provider_response", preferred).p95 || undefined,
    lag: input.lag,
  });

  const budgeted = { ...input, context: applyProfile(input.context, decision.profile) };
  // When the provider validates against INTERPRETER_JSON_SCHEMA itself, the
  // prose restatement of that shape is ~188 tokens of duplicated effort on
  // every one of ~11 calls a minute.
  const system = systemPromptFor(input.mode, {
    schemaEnforced: caps.structuredOutput,
  });
  const user = buildLiveUserPrompt(budgeted);

  const systemTokens = estimateTokens(system);
  const pendingTokens = estimateTokens(input.pending);
  const contextTokens = Math.max(0, estimateTokens(user) - pendingTokens);

  /* --- Route ------------------------------------------------------------ */
  const dispatchedAt = Date.now();
  telemetry.recordLatency({
    stage: "trigger_to_dispatch",
    ms: dispatchedAt - receivedAt,
    provider: preferred,
  });

  const turnDeadline = turnBudgetFor(input.lag);
  const turnController = new AbortController();
  const turnTimer = setTimeout(() => turnController.abort(), turnDeadline);

  try {
    const result = await router.complete(
      {
        system,
        user,
        maxOutputTokens: 700,
        temperature: 0.2,
        // Native schema enforcement where the provider has it. Zod still runs.
        jsonSchema: INTERPRETER_JSON_SCHEMA,
        // Live interpretation never wants extended reasoning.
        thinking: "none",
        signal: turnController.signal,
      },
      {
        deadlineMs: deadlineFor({ workflow: "live", lag: input.lag, provider: preferred }),
        estimatedTokens: systemTokens + contextTokens + pendingTokens,
        validate: (response) => parseInterpreterOutput(response.text) !== null,
      },
    );

    const output = parseInterpreterOutput(result.response.text);
    telemetry.recordSchemaResult(output !== null);

    for (const attempt of result.attempts) {
      if (!attempt.ok && attempt.failureKind) telemetry.recordFailure(attempt.failureKind);
    }

    if (!output) {
      // The router's validator should have caught this; belt and braces.
      return NextResponse.json({
        output: localOutput(),
        provider: "local",
        model: "deterministic",
        degraded: true,
        reason: "The interpretation model returned output that did not match the schema.",
        profile: decision.profile,
        attempts: result.attempts,
      });
    }

    /* --- Quality escalation ---------------------------------------------
     * Only ever attempted with measured budget left in the turn, and its
     * result is dropped rather than waited for. The interpreter's answer is
     * the primary one unless a better one arrived in time to still be useful.
     */
    const escalation = escalationDecision({
      enabled: appEnv().llm.openrouter.qualityEscalation,
      lag: input.lag,
      detectedKinds: (input.detected?.culturalNotes ?? []).map((note) => note.kind),
      primary: output,
      elapsedMs: Date.now() - receivedAt,
      turnBudgetMs: turnDeadline,
    });

    let finalOutput = output;
    let escalatedTo: string | undefined;
    if (escalation.escalate) {
      const better = await tryEscalate({
        system,
        user,
        deadlineMs: escalation.deadlineMs,
        signal: turnController.signal,
      });
      if (better && escalationImproves(output, better.output)) {
        finalOutput = better.output;
        escalatedTo = better.model;
      }
    }

    telemetry.recordLatency({
      stage: "provider_response",
      ms: result.response.latencyMs,
      provider: result.provider,
      model: result.model,
    });
    telemetry.recordTokens({
      provider: result.provider,
      systemTokens,
      contextTokens,
      pendingTokens,
      outputTokens: result.response.usage?.outputTokens,
      totalTokens:
        result.response.usage?.totalTokens ?? systemTokens + contextTokens + pendingTokens,
      reported: result.response.usage?.totalTokens !== undefined,
    });

    return NextResponse.json({
      output: finalOutput,
      provider: result.provider,
      // The model that actually produced what is on screen. When escalation
      // replaced the answer, saying the primary model produced it would make
      // the diagnostics page lie about a mid-session model change.
      model: escalatedTo ?? result.model,
      escalated: !!escalatedTo,
      degraded: result.degraded,
      reason: result.reason,
      profile: decision.profile,
      profileReason: decision.reason,
      latencyMs: result.response.latencyMs,
      attempts: result.attempts,
    });
  } catch (error) {
    telemetry.recordFailure("turn_failed");
    return NextResponse.json({
      output: localOutput(),
      provider: "local",
      model: "deterministic",
      degraded: true,
      reason:
        error instanceof Error
          ? `Interpretation unavailable: ${error.message}`
          : "Interpretation is unavailable.",
      profile: decision.profile,
    });
  } finally {
    clearTimeout(turnTimer);
  }
}

/**
 * One escalation attempt against the OpenRouter quality model.
 *
 * Every failure path returns null. Escalation is a bonus, so a timeout, a 429
 * or a malformed answer costs nothing but the attempt — the primary answer is
 * already in hand and is what the interpreter gets.
 */
async function tryEscalate(input: {
  system: string;
  user: string;
  deadlineMs: number;
  signal: AbortSignal;
}): Promise<{ output: NonNullable<ReturnType<typeof parseInterpreterOutput>>; model: string } | null> {
  const provider = createQualityProvider(appEnv());
  if (!provider) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.deadlineMs);
  const onAbort = () => controller.abort();
  input.signal.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await provider.complete({
      system: input.system,
      user: input.user,
      maxOutputTokens: 700,
      temperature: 0.2,
      jsonSchema: INTERPRETER_JSON_SCHEMA,
      thinking: "none",
      signal: controller.signal,
    });
    const output = parseInterpreterOutput(response.text);
    if (!output) return null;
    telemetry.recordLatency({
      stage: "provider_response",
      ms: response.latencyMs,
      provider: "openrouter",
      model: response.model ?? provider.model,
    });
    return { output, model: response.model ?? provider.model };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", onAbort);
  }
}

/** Re-exported so the benchmark harness validates the same way the route does. */
export const validateOutput = (text: string) =>
  interpreterOutputSchema.safeParse(parseInterpreterOutput(text)).success;
