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
 */
import { NextResponse } from "next/server";
import { interpretRequestSchema, interpreterOutputSchema, parseInterpreterOutput } from "@/lib/schema";
import { buildLiveUserPrompt, systemPromptFor } from "@/interpreter/prompts/live";
import { INTERPRETER_JSON_SCHEMA } from "@/interpreter/prompts/json-schema";
import { applyProfile, chooseProfile } from "@/interpreter/context/profiles";
import { capabilitiesFor, deadlineFor, llmRouter, turnBudgetFor } from "@/providers/llm";
import { interpretLocally } from "@/providers/llm/mock";
import { estimateTokens, telemetry } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const receivedAt = Date.now();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = interpretRequestSchema.safeParse(body);
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
  const system = systemPromptFor(input.mode);
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
      output,
      provider: result.provider,
      model: result.model,
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

/** Re-exported so the benchmark harness validates the same way the route does. */
export const validateOutput = (text: string) =>
  interpreterOutputSchema.safeParse(parseInterpreterOutput(text)).success;
