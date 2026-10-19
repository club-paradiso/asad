import { NextResponse } from "next/server";
import { appEnv } from "@/lib/env";
import { guardInferenceRoute } from "@/lib/guard";
import { interpretRequestSchema, parseInterpreterOutput } from "@/lib/schema";
import { INTERPRETER_JSON_SCHEMA } from "@/interpreter/prompts/json-schema";
import { GeminiLlmProvider } from "@/providers/llm/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MODEL = "gemini-3.1-flash-lite";

/**
 * Earbud translation is ALWAYS pinned to the verified free-tier-capable
 * translation model. No paid router, quality escalation or gateway fallback.
 * Google could still bill a paid API project: a free-only API key/project and
 * billing disabled must be configured by the owner before production.
 */
export async function POST(request: Request) {
  const guarded = await guardInferenceRoute(request, {
    requireSession: true,
    maxBodyBytes: 16 * 1024,
    limits: [
      { rule: "interpretSession", by: "session" },
      { rule: "interpretAddress", by: "address" },
    ],
  });
  if (!guarded.ok) return guarded.response;
  const input = interpretRequestSchema.safeParse(guarded.body);
  if (!input.success || input.data.target !== "ko-KR" || input.data.source === "ko-KR") {
    return NextResponse.json({ error: "Invalid earbud language pair." }, { status: 400 });
  }
  const env = appEnv();
  const key = env.llm.providers.gemini.apiKey;
  if (!key || env.llm.paidTier.has("gemini") || !env.access.key) {
    return NextResponse.json({
      error: "Earbud free-tier Gemini is unavailable. Configure a private, free-tier Gemini project.",
    }, { status: 503 });
  }
  const source = input.data.source;
  const speech = input.data.pending.slice(0, 1800);
  // A short task-specific contract reduces token use and TTFT. The existing
  // validated response schema and the engine's time-locking still apply.
  const system = [
    "You are a faithful spoken-language interpreter for a mock practice dialogue.",
    "Translate only from " + source + " into Korean (ko-KR).",
    "Keep names, visa classes, dates and amounts verbatim; do not invent details.",
    "Return JSON satisfying the provided schema. Use exactly one safeChunks item",
    "with clear, natural, short Korean speech. Never use anticipatedChunks.",
    "If audio transcription seems incomplete, translate only what's explicit.",
    "Do not give legal advice, status decisions or refugee-eligibility predictions.",
    "For untranslatable or ambiguous text output safeChunks: [] and confidence low.",
    "Don't output source-language text pretending it is a Korean translation.",
  ].join(" ");
  const previous = input.data.history?.recentKorean?.slice(-2) ?? [];
  const user = `Prior utterances (context only): ${JSON.stringify(previous).slice(0, 500)}\nTranslate this utterance to Korean: ${speech}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const provider = new GeminiLlmProvider({ apiKey: key, model: MODEL });
    const result = await provider.complete({
      system, user, maxOutputTokens: 320,
      temperature: 0.1, thinking: "none",
      jsonSchema: INTERPRETER_JSON_SCHEMA, signal: controller.signal,
    });
    const output = parseInterpreterOutput(result.text);
    if (!output) {
      return NextResponse.json({ error: "Invalid translation response." }, { status: 502 });
    }
    // Server-side safety: never let anticipation or an out-of-language echo be
    // voiced as a completed translation. Engine client still checks confidence.
    output.anticipatedChunks = [];
    return NextResponse.json({ output, provider: "gemini", model: MODEL }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const quota = /429|quota|rate.limit/i.test(message);
    return NextResponse.json({
      error: quota ? "Free-tier quota reached. Interpretation is paused." : "Translation model is unavailable.",
    }, { status: quota ? 429 : 503 });
  } finally {
    clearTimeout(timer);
  }
}
