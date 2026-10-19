import { NextResponse } from "next/server";
import { guardInferenceRoute } from "@/lib/guard";
import { interpretRequestSchema } from "@/lib/schema";
import { GeminiLlmProvider } from "@/providers/llm/gemini";
import { ensembleConfig } from "@/features/earbud/ensemble/config";
import { runEnsemble, type EnsembleInput } from "@/features/earbud/ensemble/runner";
import type { TranslationCandidate } from "@/features/earbud/ensemble/decision";
import { translateIndex, translateAzure } from "@/features/earbud/ensemble/providers";
import { reserveAzureCharacters } from "@/features/earbud/ensemble/azure-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_JUDGE_MODEL = "gemini-3.5-flash-lite";
const CACHE_CONTROL = { "Cache-Control": "private, no-store" };

function judgeTranslation(key: string) {
  return async (input: EnsembleInput, candidates: readonly TranslationCandidate[], signal: AbortSignal) => {
    const evaluator = new GeminiLlmProvider({ apiKey: key, model: GEMINI_JUDGE_MODEL });
    // Selection-only, never allow Gemini to synthesize a fourth translation.
    const result = await evaluator.complete({
      system: [
        "You evaluate Korean translations, not legal or immigration decisions.",
        "Choose the candidate that preserves the SOURCE meaning, not the one",
        "that sounds nicest. Compare negation, names, numbers, dates, and codes.",
        "When uncertain, choose abstain. Never merge or rewrite translations.",
        'Return only JSON {"choice":"index"|"azure"|"abstain"}.',
      ].join(" "),
      user: JSON.stringify({
        sourceLanguage: input.source, original: input.text,
        candidates: candidates.map((c) => ({ id: c.provider, translation: c.text })),
      }),
      maxOutputTokens: 100, thinking: "none", temperature: 0,
      jsonSchema: {
        type: "object", properties: {
          choice: { type: "string", enum: ["index", "azure", "abstain"] },
        },
        required: ["choice"], additionalProperties: false,
      },
      signal,
    });
    const data: unknown = JSON.parse(result.text);
    if (typeof data !== "object" || data === null || !("choice" in data)) return "abstain";
    const choice = (data as { choice: unknown }).choice;
    return choice === "index" || choice === "azure" ? choice : "abstain";
  };
}

export async function POST(request: Request) {
  const guarded = await guardInferenceRoute(request, {
    requireSession: true, maxBodyBytes: 16 * 1024,
    limits: [
      { rule: "interpretSession", by: "session" },
      { rule: "interpretAddress", by: "address" },
    ],
  });
  if (!guarded.ok) return guarded.response;
  const parsed = interpretRequestSchema.safeParse(guarded.body);
  if (!parsed.success || parsed.data.target !== "ko-KR" || parsed.data.source === "ko-KR") {
    return NextResponse.json({ error: "Unsupported language pair." }, { status: 400 });
  }
  const cfg = ensembleConfig();
  if (!cfg.enabled || !cfg.azureKey) {
    return NextResponse.json({
      error: "Free-only ensemble is not explicitly configured in this private deployment.",
    }, { status: 503 });
  }
  const text = parsed.data.pending.trim();
  if (!text || text.length > 1200) {
    return NextResponse.json({ error: "Utterance too long for the ensemble." }, { status: 400 });
  }
  // Reserve the full Azure F0 input-character amount before starting either
  // provider. A missing Redis store, quota exhaustion or Redis outage blocks
  // the ensemble instead of silently consuming paid Azure characters.
  const reserved = await reserveAzureCharacters([...text].length);
  if (!reserved) return NextResponse.json({
    error: "Azure F0 monthly guard unavailable or exhausted. Ensemble disabled.",
  }, { status: 503, headers: CACHE_CONTROL });
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 4_200);
  try {
    const result = await runEnsemble(
      { text, source: parsed.data.source }, deadline.signal,
      {
        index: translateIndex,
        azure: (input, signal) => translateAzure(input, signal, cfg.azureKey!, cfg.azureRegion),
        judge: cfg.geminiKey ? judgeTranslation(cfg.geminiKey) : undefined,
        candidateTimeoutMs: 2_700, judgeTimeoutMs: 1_250,
      },
    );
    // The current engine expects the existing InterpreterOutput schema. An
    // abstention is NOT a successful translation, and must never enter TTS.
    return NextResponse.json({
      output: {
        safeChunks: result.text ? [{ text: result.text, confidence: result.confidence }] : [],
        anticipatedChunks: [], confidence: result.confidence,
      },
      provider: result.text ? "ensemble" : "ensemble-abstained",
      model: result.selected ?? "no-consensus",
      degraded: !result.text || result.adjudication !== "agreement",
      reason: result.reason,
      // timings are integers, never input or candidate text.
      metrics: { timings: result.timings, adjudication: result.adjudication },
    }, { headers: CACHE_CONTROL });
  } catch {
    return NextResponse.json({
      // Network failures and quota expiry must not trigger a paid fallback.
      output: { safeChunks: [], confidence: "low", anticipatedChunks: [] },
      provider: "ensemble-abstained", model: "unavailable", degraded: true,
      reason: "Free ensemble timed out or became unavailable. Speech withheld.",
    }, { headers: CACHE_CONTROL });
  } finally {
    clearTimeout(timer);
  }
}
