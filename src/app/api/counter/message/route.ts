/**
 * POST /api/counter/message — send one utterance and get it translated.
 *
 * Synchronous from the user's point of view: the message is stored complete,
 * with its translation, or stored as `failed`. The backing session store may be
 * shared Redis, so every read/write is awaited and atomic at the store layer.
 *
 * Quick phrases short-circuit the model entirely.
 */
import { NextResponse } from "next/server";
import { counterMessageSchema } from "@/lib/schema";
import { appendMessage, counterStore, sourceLangFor, targetLangFor } from "@/counter/store";
import { normaliseCode } from "@/counter/codes";
import { resolveQuickPhrase } from "@/counter/quick-phrases";
import { detectRisks } from "@/counter/risks";
import { extractCriticalValues, validateTranslationIntegrity } from "@/counter/integrity";
import { translateForCounter } from "@/counter/translate";
import { detectCounterProfile } from "@/counter/profile-detection";
import type { CounterMessage } from "@/counter/types";
import { guardInferenceRoute } from "@/lib/guard";
import { buildHumanReviewFlags } from "@/learning/review";
import { recordLearningCandidate } from "@/learning/vault";
import { randomUUID } from "node:crypto";
import {
  COUNTER_TOKEN_HEADER,
  counterTokenFrom,
  participantForToken,
} from "@/counter/access";
import { toParticipantMessage } from "@/counter/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const MESSAGE_ID_RE = /^[A-Za-z0-9._:-]{8,96}$/;

// IDs must remain unique when two Vercel workers write in the same millisecond.
const nextId = () => `m_${randomUUID()}`;

export async function POST(request: Request) {
  const guarded = await guardInferenceRoute(request, {
    requireSession: true,
    deferredCredentialHeader: COUNTER_TOKEN_HEADER,
    maxBodyBytes: MAX_BODY_BYTES,
    limits: [{ rule: "counter", by: "session" }, { rule: "counter", by: "address" }],
  });
  if (!guarded.ok) return guarded.response;

  const parsed = counterMessageSchema.safeParse(guarded.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const code = normaliseCode(parsed.data.code);
  if (!code) return NextResponse.json({ error: "Invalid code." }, { status: 400 });

  const rawRequestId = request.headers.get("x-asad-message-id")?.trim() ?? "";
  const clientRequestId = MESSAGE_ID_RE.test(rawRequestId) ? rawRequestId : undefined;

  const store = counterStore();
  const session = await store.get(code);
  if (!session) {
    return NextResponse.json({ error: "Session not found or expired." }, { status: 404 });
  }
  if (!session.guestLang) {
    return NextResponse.json(
      { error: "Waiting for the visitor to choose a language." },
      { status: 409 },
    );
  }

  const from = participantForToken(session, counterTokenFrom(request));
  if (!from) {
    return NextResponse.json({ error: "Session authorisation required." }, { status: 401 });
  }

  const { source, rephraseOf, action, actionOf } = parsed.data;
  let text = parsed.data.text;

  if (clientRequestId) {
    const duplicate = session.messages.find(
      (message) => message.from === from && message.clientRequestId === clientRequestId,
    );
    if (duplicate) {
      return NextResponse.json({
        message: toParticipantMessage(duplicate, from),
        viaModel: duplicate.source !== "quick-phrase" && duplicate.source !== "confirm",
        duplicate: true,
      });
    }
  }

  if ((action && !actionOf) || (!action && actionOf) || (action && source !== "text")) {
    return NextResponse.json({ error: "Invalid message action." }, { status: 400 });
  }
  if (action && actionOf) {
    const original = session.messages.find(
      (message) => message.id === actionOf && message.from === from,
    );
    if (!original || original.source === "quick-phrase" || original.source === "confirm") {
      return NextResponse.json({ error: "That message cannot be translated again." }, { status: 400 });
    }
    text = original.originalText;
  }
  const originalLang = sourceLangFor(session, from);
  const targetLang = targetLangFor(session, from);

  const persistOnce = async (
    message: Omit<CounterMessage, "seq">,
  ): Promise<{ message: CounterMessage; duplicate: boolean } | null> => {
    let duplicate = false;
    const stored = await store.update(code, (s) => {
      const existing = clientRequestId
        ? s.messages.find(
            (item) => item.from === from && item.clientRequestId === clientRequestId,
          )
        : undefined;
      if (existing) {
        duplicate = true;
        return;
      }
      appendMessage(s, message);
    });
    if (!stored) return null;

    const persisted = clientRequestId
      ? stored.messages.find(
          (item) => item.from === from && item.clientRequestId === clientRequestId,
        )
      : stored.messages[stored.messages.length - 1];
    if (!persisted) return null;
    return { message: persisted, duplicate };
  };

  if (source === "quick-phrase") {
    const resolved = resolveQuickPhrase(text, originalLang, targetLang);
    if (resolved) {
      const message: Omit<CounterMessage, "seq"> = {
        id: nextId(),
        from,
        source: "quick-phrase",
        clientRequestId,
        originalText: resolved.originalText,
        originalLang,
        translatedText: resolved.translatedText,
        targetLang,
        at: Date.now(),
        status: "done",
        confidence: "high",
      };
      const persisted = await persistOnce(message);
      if (!persisted) {
        return NextResponse.json({ error: "Session not found or expired." }, { status: 404 });
      }
      return NextResponse.json({
        message: toParticipantMessage(persisted.message, from),
        viaModel: false,
        duplicate: persisted.duplicate,
      });
    }
  }

  if (source === "confirm") {
    const message: Omit<CounterMessage, "seq"> = {
      id: nextId(),
      from,
      source: "confirm",
      clientRequestId,
      originalText: text,
      originalLang,
      translatedText: text,
      targetLang,
      at: Date.now(),
      status: "done",
      confidence: "high",
      risks: detectRisks(text),
    };
    const persisted = await persistOnce(message);
    if (!persisted) {
      return NextResponse.json({ error: "Session not found or expired." }, { status: 404 });
    }
    return NextResponse.json({
      message: toParticipantMessage(persisted.message, from),
      viaModel: false,
      duplicate: persisted.duplicate,
    });
  }

  // Six turns is still compact enough for free-tier models, but gives short
  // multilingual replies enough context to resolve pronouns and omitted subjects.
  const recentMessages = session.messages.slice(-6);
  const recent = recentMessages.map((m) => ({
    from: m.from,
    text: m.originalText,
    lang: m.originalLang,
  }));

  const detectedProfileId = detectCounterProfile({
    text,
    deskLabel: session.deskLabel,
    recent,
    currentProfileId: session.profileId,
  });
  let effectiveProfileId = session.profileId;
  // Always re-evaluate inside the atomic mutation. A concurrent sensitive turn
  // may have upgraded the session after this request's initial read; skipping
  // the mutation merely because this stale snapshot looked unchanged would
  // let the ambiguous turn use the general policy.
  const updated = await store.update(code, (current) => {
    current.profileId = detectCounterProfile({
      text,
      deskLabel: current.deskLabel,
      recent: current.messages.slice(-6).map((message) => ({
        text: message.originalText,
      })),
      currentProfileId: current.profileId,
    });
  });
  effectiveProfileId = updated?.profileId ?? detectedProfileId;
  // An exact keyword match can promote a session into a specialised profile,
  // but lack of a match is not proof that an utterance is non-sensitive—most
  // supported languages cannot be exhaustively enumerated. Keep an unresolved
  // general session on the strict, single-provider privacy path until a
  // concrete non-sensitive desk/conversation profile is established.
  const forceSensitiveRouting = effectiveProfileId === "general";

  const result = await translateForCounter({
    text,
    sourceLang: originalLang,
    targetLang,
    recent,
    inputMode: source === "voice" ? "voice" : "text",
    rephrase: !!rephraseOf,
    action,
    deskLabel: session.deskLabel,
    profileId: effectiveProfileId,
    forceSensitiveRouting,
    routingKey: `counter:${code}`,
  });

  const base = {
    id: nextId(),
    from,
    source,
    clientRequestId,
    originalText: text,
    originalLang,
    targetLang,
    at: Date.now(),
    rephraseOf,
    action,
    actionOf,
  };

  const message: Omit<CounterMessage, "seq"> = result.ok
    ? {
        ...base,
        translatedText: result.output!.translation,
        status: "done",
        confidence: result.output!.confidence,
        note: result.output!.note,
        risks: detectRisks(result.output!.translation),
        criticalValues: extractCriticalValues(text, originalLang),
        integrity: validateTranslationIntegrity(
          text,
          result.output!.translation,
          originalLang,
          targetLang,
        ),
      }
    : {
        ...base,
        translatedText: "",
        status: "failed",
        error: result.error,
      };

  if (message.status === "done" && message.integrity?.status === "mismatch") {
    message.confidence = "low";
  }

  if (message.status === "done") {
    const reviewFlags = buildHumanReviewFlags({
      sourceText: text,
      confidence: message.confidence,
      integrity: message.integrity,
    });
    if (reviewFlags.length) message.reviewFlags = reviewFlags;
  }

  const persisted = await persistOnce(message);
  if (!persisted) {
    return NextResponse.json({ error: "Session not found or expired." }, { status: 404 });
  }

  if (!persisted.duplicate && message.status === "done" && !forceSensitiveRouting) {
    try {
      await recordLearningCandidate({
        sourceText: message.originalText,
        modelTranslation: message.translatedText,
        sourceLang: message.originalLang,
        targetLang: message.targetLang,
        profileId: effectiveProfileId,
        confidence: message.confidence,
        integrity: message.integrity,
        reviewFlags: message.reviewFlags,
      });
    } catch {
      console.warn("Learning Vault write failed.");
    }
  }

  return NextResponse.json({
    message: toParticipantMessage(persisted.message, from),
    viaModel: true,
    duplicate: persisted.duplicate,
    provider: result.provider,
    latencyMs: result.latencyMs,
  });
}
