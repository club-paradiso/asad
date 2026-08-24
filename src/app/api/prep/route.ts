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
import { resolveLlmProvider } from "@/providers/llm";
import { localPrepBrief } from "@/interpreter/prep/local-brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 45_000;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = prepRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const { provider, degraded: providerDegraded, reason } = resolveLlmProvider();

  if (provider.id === "mock") {
    return NextResponse.json({
      brief: localPrepBrief(input),
      provider: "mock",
      degraded: providerDegraded || true,
      reason:
        reason ??
        "No interpretation model configured — this brief was built from your prep sheet alone.",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const raw = await provider.complete({
      system: PREP_SYSTEM_PROMPT,
      user: buildPrepUserPrompt(input),
      maxOutputTokens: 2400,
      temperature: 0.3,
      signal: controller.signal,
    });

    const json = extractJsonObject(raw);
    const value: unknown = json ? safeJson(json) : null;
    const brief = prepBriefSchema.safeParse(value);

    if (!brief.success) {
      return NextResponse.json({
        brief: localPrepBrief(input),
        provider: provider.id,
        degraded: true,
        reason: "The model returned a brief that did not match the schema.",
      });
    }

    return NextResponse.json({ brief: brief.data, provider: provider.id, degraded: false });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json({
      brief: localPrepBrief(input),
      provider: provider.id,
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
