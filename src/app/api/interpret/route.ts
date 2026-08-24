/**
 * POST /api/interpret — the live interpretation endpoint.
 *
 * Runs on the server so the LLM key never reaches the browser. Two invariants:
 *
 *  1. It always answers with a valid `InterpreterOutput`. A vendor failure, a
 *     timeout or malformed model output degrades to the deterministic local
 *     interpreter and is reported in `degraded` — the console keeps running.
 *  2. It never streams prose. The response is validated against the Zod schema
 *     before it leaves this file.
 */
import { NextResponse } from "next/server";
import { interpretRequestSchema, parseInterpreterOutput } from "@/lib/schema";
import { buildLiveUserPrompt, systemPromptFor } from "@/interpreter/prompts/live";
import { resolveLlmProvider } from "@/providers/llm";
import { interpretLocally } from "@/providers/llm/mock";
import { LlmError } from "@/providers/llm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A live turn that takes longer than this is already useless. */
const TIMEOUT_MS = 12_000;

export async function POST(request: Request) {
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

  const { provider, degraded: providerDegraded, reason } = resolveLlmProvider();

  // The local interpreter needs no round trip at all.
  if (provider.id === "mock") {
    return NextResponse.json({
      output: interpretLocally({
        pending: input.pending,
        mode: input.mode,
        allowAnticipation: input.allowAnticipation,
      }),
      provider: "mock",
      degraded: providerDegraded,
      reason,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const raw = await provider.complete({
      system: systemPromptFor(input.mode),
      user: buildLiveUserPrompt(input),
      maxOutputTokens: 700,
      temperature: 0.2,
      signal: controller.signal,
    });

    const output = parseInterpreterOutput(raw);
    if (!output) {
      // Malformed output is a provider fault, not a session-ending event.
      return NextResponse.json({
        output: interpretLocally({
          pending: input.pending,
          mode: input.mode,
          allowAnticipation: input.allowAnticipation,
        }),
        provider: provider.id,
        degraded: true,
        reason: "The interpretation model returned output that did not match the schema.",
      });
    }

    return NextResponse.json({ output, provider: provider.id, degraded: false });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    const message = aborted
      ? "The interpretation model did not respond in time."
      : error instanceof LlmError
        ? error.message
        : "The interpretation model is unavailable.";

    return NextResponse.json({
      output: interpretLocally({
        pending: input.pending,
        mode: input.mode,
        allowAnticipation: input.allowAnticipation,
      }),
      provider: provider.id,
      degraded: true,
      reason: message,
    });
  } finally {
    clearTimeout(timeout);
  }
}
