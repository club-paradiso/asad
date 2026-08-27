/**
 * POST /api/prep — generate a pre-session interpretation brief.
 *
 * Not latency-critical, so it may take its time. Like the live route it never
 * fails hard: with no model configured it returns a deterministic brief built
 * from the prep sheet itself, which is still worth reading.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prepBriefSchema, prepRequestSchema, extractJsonObject } from "@/lib/schema";
import { buildPrepUserPrompt, PREP_SYSTEM_PROMPT } from "@/interpreter/prompts/prep";
import { deadlineFor, llmRouter } from "@/providers/llm";
import { localPrepBrief } from "@/interpreter/prep/local-brief";
import { guardInferenceRoute } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 45_000;

/** A prep sheet carries an outline, so it is allowed to be larger than a turn. */
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  // Prep runs a long, expensive generation. It is the single most attractive
  // route on this deployment to abuse, and the least latency-sensitive to
  // guard.
  const guarded = await guardInferenceRoute(request, {
    requireSession: true,
    maxBodyBytes: MAX_BODY_BYTES,
    limits: [{ rule: "prep", by: "session" }, { rule: "prep", by: "address" }],
  });
  if (!guarded.ok) return guarded.response;

  const parsed = prepRequestSchema.safeParse(guarded.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const router = llmRouter();
  const preferred = router.preferred();

  if (!preferred || preferred === "local") {
    return NextResponse.json({
      brief: localPrepBrief(input),
      provider: "local",
      degraded: true,
      reason:
        "No interpretation model configured — this brief was built from your prep sheet alone.",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Prep is not latency-critical, so unlike the live path it is allowed to
    // think and to take its time.
    const result = await router.complete(
      {
        system: PREP_SYSTEM_PROMPT,
        user: buildPrepUserPrompt(input),
        maxOutputTokens: 2400,
        temperature: 0.3,
        thinking: "low",
        signal: controller.signal,
      },
      { deadlineMs: deadlineFor({ workflow: "prep" }) },
    );

    const raw = result.response.text;
    const json = extractJsonObject(raw);
    const value: unknown = json ? safeJson(json) : null;
    const brief = prepBriefSchema.safeParse(value);

    if (!brief.success) {
      return NextResponse.json({
        brief: localPrepBrief(input),
        provider: result.provider,
        degraded: true,
        reason: "The model returned a brief that did not match the schema.",
      });
    }

    return NextResponse.json({
      brief: brief.data,
      provider: result.provider,
      model: result.model,
      degraded: result.degraded,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json({
      brief: localPrepBrief(input),
      provider: "local",
      degraded: true,
      reason: aborted
        ? "The model did not respond in time."
        : "The model is unavailable — this brief was built from your prep sheet alone.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export type PrepResponse = {
  brief: z.infer<typeof prepBriefSchema>;
  provider: string;
  degraded: boolean;
  reason?: string;
};
