import { NextResponse } from "next/server";
import { appEnv } from "@/lib/env";
import { guardInferenceRoute } from "@/lib/guard";
import { interpretRequestSchema } from "@/lib/schema";
import { checkCandidate } from "@/features/earbud/ensemble/decision";
import { translateIndex, INDEX_MODEL } from "@/features/earbud/ensemble/providers";
import { earbudPairProblem } from "@/features/earbud/language-pairs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

/**
 * Phase 4B isolated real-provider test. Accessible only on explicitly
 * configured, access-gated preview. Never substitutes or provisions Azure.
 * Fail closed if the public API is unavailable, or the source critical
 * identifiers/negation are not conservatively preserved.
 */
export async function POST(request: Request) {
  const guarded = await guardInferenceRoute(request, {
    requireSession: true, maxBodyBytes: 16 * 1024,
    limits: [
      { rule: "interpretSession", by: "session" },
      { rule: "interpretAddress", by: "address" },
    ],
  });
  if (!guarded.ok) return guarded.response;
  const env = appEnv();
  if (!env.access.key || process.env.ASAD_INDEX_TRANSLATE_PUBLIC !== "1") {
    return NextResponse.json({
      error: "Index public API preview is not explicitly enabled.",
    }, { status: 503, headers: HEADERS });
  }
  const parsed = interpretRequestSchema.safeParse(guarded.body);
  if (!parsed.success || earbudPairProblem(parsed.data.source, parsed.data.target)) {
    return NextResponse.json({ error: "Unsupported language pair." }, { status: 400 });
  }
  const text = parsed.data.pending.trim();
  if (text.length < 2 || text.length > 1200) {
    return NextResponse.json({ error: "Unsupported utterance length." }, { status: 400 });
  }
  const started = Date.now();
  const deadline = AbortSignal.timeout(4200);
  let translated: string | null = null;
  let reason = "Index API returned no translation.";
  try {
    const result = await translateIndex({ text, source: parsed.data.source, target: parsed.data.target as "ko-KR" | "en-US" }, deadline);
    const verdict = checkCandidate(text, result, parsed.data.target);
    if (verdict.ok) {
      translated = result;
      reason = "Index translation passed deterministic format and critical-token checks; semantics not yet human-validated.";
    } else {
      reason = "Index response withheld: " + verdict.reason;
    }
  } catch {
    reason = "Index public API timeout, network failure or rate limit; no spoken fallback.";
  }
  return NextResponse.json({
    output: {
      safeChunks: translated ? [{ text: translated, confidence: "medium" }] : [],
      anticipatedChunks: [], confidence: translated ? "medium" : "low",
    },
    provider: translated ? "index" : "index-abstained",
    model: INDEX_MODEL,
    degraded: !translated,
    reason,
    metrics: { latencyMs: Math.max(0, Date.now() - started) },
  }, { headers: HEADERS });
}
