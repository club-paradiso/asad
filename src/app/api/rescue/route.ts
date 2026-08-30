/**
 * POST /api/rescue — emergency catch-up inference for a human interpreter.
 *
 * This is deliberately separate from /api/interpret. Rescue must never drain,
 * cancel, commit, or otherwise mutate the ordinary live interpretation queue.
 * The client supplies a bounded recent-Korean window; this route asks only for
 * the minimum safe bridge into the latest resolved idea.
 */
import { NextResponse } from "next/server";
import { rescueRequestSchema } from "@/lib/rescue-schema";
import { parseInterpreterOutput } from "@/lib/schema";
import { buildRescueUserPrompt } from "@/interpreter/prompts/rescue";
import { systemPromptFor } from "@/interpreter/prompts/live";
import { INTERPRETER_JSON_SCHEMA } from "@/interpreter/prompts/json-schema";
import {
  emptyRescueOutput,
  sanitizeRescueOutput,
} from "@/interpreter/engine/rescue-output";
import { applyProfile, chooseProfile } from "@/interpreter/context/profiles";
import {
  capabilitiesFor,
  deadlineFor,
  llmRouter,
  turnBudgetFor,
} from "@/providers/llm";
import { guardInferenceRoute } from "@/lib/guard";
import { estimateTokens, telemetry } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const receivedAt = Date.now();
  const guarded = await guardInferenceRoute(request, {
    requireSession: true,
    maxBodyBytes: MAX_BODY_BYTES,
    // Rescue shares the live budget. It is an occasional emergency turn, not a
    // second allowance that a client can use to double provider spend.
    limits: [
      { rule: "interpretSession", by: "session" },
      { rule: "interpretAddress", by: "address" },
    ],
  });
  if (!guarded.ok) return guarded.response;

  const parsed = rescueRequestSchema.safeParse(guarded.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid rescue request.", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const router = llmRouter();
  const preferred = router.preferred();

  if (!preferred || preferred === "local") {
    return NextResponse.json({
      output: emptyRescueOutput(),
      provider: "local",
      model: "none",
      degraded: true,
      reason:
        "No cloud model is available for Rescue. Normal live interpreting remains unchanged.",
    });
  }

  const caps = capabilitiesFor(preferred);
  const profile = chooseProfile({
    recommendedLiveTokens: caps.recommendedLiveContextTokens,
    quotaPressure: router.pressureFor(preferred),
    latencyP95Ms: telemetry.stage("provider_response", preferred).p95 || undefined,
    // Rescue is an emergency action. Budget context as aggressively as FAST.
    lag: "fast",
  });
  const context = applyProfile(input.context, profile.profile);
  const system = systemPromptFor(input.mode, {
    schemaEnforced: caps.structuredOutput,
  });
  const user = buildRescueUserPrompt({
    mode: input.mode,
    recentKorean: input.recentKorean,
    context,
  });

  if (!user) {
    return NextResponse.json({
      output: emptyRescueOutput(),
      provider: "local",
      model: "none",
      degraded: true,
      reason: "There is no recent stable Korean to rescue.",
    });
  }

  const turnBudget = turnBudgetFor("fast");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), turnBudget);

  try {
    telemetry.recordLatency({
      stage: "trigger_to_dispatch",
      ms: Date.now() - receivedAt,
      provider: preferred,
    });

    const estimatedTokens = estimateTokens(system) + estimateTokens(user);
    const result = await router.complete(
      {
        system,
        user,
        maxOutputTokens: 320,
        temperature: 0.1,
        jsonSchema: INTERPRETER_JSON_SCHEMA,
        thinking: "none",
        signal: controller.signal,
      },
      {
        deadlineMs: deadlineFor({
          workflow: "live",
          lag: "fast",
          provider: preferred,
        }),
        estimatedTokens,
        validate: (response) => parseInterpreterOutput(response.text) !== null,
      },
    );

    const parsedOutput = parseInterpreterOutput(result.response.text);
    if (!parsedOutput) {
      telemetry.recordSchemaResult(false);
      return NextResponse.json({
        output: emptyRescueOutput(),
        provider: "local",
        model: "none",
        degraded: true,
        reason:
          "The Rescue model returned unusable output. Normal live interpreting remains unchanged.",
        attempts: result.attempts,
      });
    }

    telemetry.recordSchemaResult(true);
    telemetry.recordLatency({
      stage: "provider_response",
      ms: result.response.latencyMs,
      provider: result.provider,
      model: result.model,
    });

    const output = sanitizeRescueOutput(parsedOutput);
    return NextResponse.json({
      output,
      provider: result.provider,
      model: result.model,
      degraded: result.degraded,
      reason: result.reason,
      profile: profile.profile,
      latencyMs: result.response.latencyMs,
      attempts: result.attempts,
    });
  } catch (error) {
    telemetry.recordFailure("turn_failed");
    return NextResponse.json({
      output: emptyRescueOutput(),
      provider: "local",
      model: "none",
      degraded: true,
      reason:
        error instanceof Error
          ? `Rescue unavailable: ${error.message}`
          : "Rescue is unavailable.",
    });
  } finally {
    clearTimeout(timer);
  }
}
