/**
 * POST /api/counter/message — send one utterance and get it translated.
 *
 * Synchronous: the message is stored complete, with its translation, or stored
 * as `failed`. There is deliberately no "pending" write-then-update dance —
 * a counter exchange is one turn at a time, and a half-written bubble that
 * later changes is worse than a short wait.
 *
 * Quick phrases short-circuit the model entirely.
 */
import { NextResponse } from "next/server";
import { counterMessageSchema } from "@/lib/schema";
import { appendMessage, counterStore, sourceLangFor, targetLangFor } from "@/counter/store";
import { normaliseCode } from "@/counter/codes";
import { resolveQuickPhrase } from "@/counter/quick-phrases";
import { detectRisks } from "@/counter/risks";
import { translateForCounter } from "@/counter/translate";
import type { CounterMessage } from "@/counter/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let counter = 0;
const nextId = () => `m${Date.now().toString(36)}${(counter += 1).toString(36)}`;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = counterMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const code = normaliseCode(parsed.data.code);
  if (!code) return NextResponse.json({ error: "Invalid code." }, { status: 400 });

  const store = counterStore();
  const session = store.get(code);
  if (!session) {
    return NextResponse.json({ error: "Session not found or expired." }, { status: 404 });
  }
  if (!session.guestLang) {
    return NextResponse.json(
      { error: "Waiting for the visitor to choose a language." },
      { status: 409 },
    );
  }

  const { from, source, text, rephraseOf } = parsed.data;
  const originalLang = sourceLangFor(session, from);
  const targetLang = targetLangFor(session, from);

  /* --- Quick phrases: no model, no latency, no variance ----------------- */
  if (source === "quick-phrase") {
    const resolved = resolveQuickPhrase(text, originalLang, targetLang);
    if (resolved) {
      const message: Omit<CounterMessage, "seq"> = {
        id: nextId(),
        from,
        source: "quick-phrase",
        originalText: resolved.originalText,
        originalLang,
        translatedText: resolved.translatedText,
        targetLang,
        at: Date.now(),
        status: "done",
        confidence: "high",
      };
      const stored = store.update(code, (s) => {
        appendMessage(s, message);
      });
      return NextResponse.json({
        message: stored!.messages[stored!.messages.length - 1],
        viaModel: false,
      });
    }
    // Missing translation for this language pair — fall through to the model
    // rather than showing the wrong language.
  }

  /* --- Confirmation read-back ------------------------------------------- */
  // A confirm message is already just the values in question. Echo them
  // verbatim: re-translating "3:00 · Kim Min-su" can only make it worse.
  if (source === "confirm") {
    const message: Omit<CounterMessage, "seq"> = {
      id: nextId(),
      from,
      source: "confirm",
      originalText: text,
      originalLang,
      translatedText: text,
      targetLang,
      at: Date.now(),
      status: "done",
      confidence: "high",
      risks: detectRisks(text),
    };
    const stored = store.update(code, (s) => {
      appendMessage(s, message);
    });
    return NextResponse.json({
      message: stored!.messages[stored!.messages.length - 1],
      viaModel: false,
    });
  }

  /* --- Model path -------------------------------------------------------- */
  const recent = session.messages.slice(-4).map((m) => ({
    from: m.from,
    text: m.originalText,
  }));

  const result = await translateForCounter({
    text,
    sourceLang: originalLang,
    targetLang,
    recent,
    rephrase: !!rephraseOf,
    deskLabel: session.deskLabel,
  });

  const base = {
    id: nextId(),
    from,
    source,
    originalText: text,
    originalLang,
    targetLang,
    at: Date.now(),
    rephraseOf,
  };

  const message: Omit<CounterMessage, "seq"> = result.ok
    ? {
        ...base,
        translatedText: result.output!.translation,
        status: "done",
        confidence: result.output!.confidence,
        note: result.output!.note,
        // Detected on the TRANSLATED text: what the other party will act on.
        risks: detectRisks(result.output!.translation),
      }
    : {
        ...base,
        translatedText: "",
        status: "failed",
        error: result.error,
      };

  const stored = store.update(code, (s) => {
    appendMessage(s, message);
  });

  return NextResponse.json({
    message: stored!.messages[stored!.messages.length - 1],
    viaModel: true,
    provider: result.provider,
    latencyMs: result.latencyMs,
  });
}
