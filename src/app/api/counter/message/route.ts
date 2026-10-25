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
import { toParticipantMessage, type Participant } from "@/counter/types";
import { afterResponse } from "@/lib/after-response";
import { telemetry } from "@/lib/telemetry";

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
  const token = counterTokenFrom(request);
  const receivedAt = Date.now();

  // One read does the whole admission: existence, visitor language,
  // capability, duplicate detection, action validity, and profile detection.
  // The store writes only when the profile actually changed, so an ordinary
  // turn costs a single Redis GET here instead of a GET, a second GET and a
  // compare-and-set. Profile detection still runs against the newest copy of
  // the session, so a concurrent sensitive turn that just upgraded the
  // conversation is honoured exactly as before.
  const { source, rephraseOf, action, actionOf } = parsed.data;
  let text = parsed.data.text;
  let from: Participant | null = null;
  let rejection: NextResponse | null = null;
  let duplicateOf: CounterMessage | undefined;
  const session = await store.update(code, (s) => {
    rejection = null;
    duplicateOf = undefined;
    if (!s.guestLang) {
      rejection = NextResponse.json(
        { error: "Waiting for the visitor to choose a language." },
        { status: 409 },
      );
      return false;
    }
    from = participantForToken(s, token);
    if (!from) {
      rejection = NextResponse.json({ error: "Session authorisation required." }, { status: 401 });
      return false;
    }
    const sender = from;
    if (clientRequestId) {
      duplicateOf = s.messages.find(
        (message) => message.from === sender && message.clientRequestId === clientRequestId,
      );
      if (duplicateOf) return false;
    }
    if ((action && !actionOf) || (!action && actionOf) || (action && source !== "text")) {
      rejection = NextResponse.json({ error: "Invalid message action." }, { status: 400 });
      return false;
    }
    if (action && actionOf) {
      const original = s.messages.find(
        (message) => message.id === actionOf && message.from === sender,
      );
      if (!original || original.source === "quick-phrase" || original.source === "confirm") {
        rejection = NextResponse.json(
          { error: "That message cannot be translated again." },
          { status: 400 },
        );
        return false;
      }
      text = original.originalText;
    }
    if (source === "quick-phrase" || source === "confirm") return false;

    // An exact keyword match can promote a session into a specialised profile.
    // Evaluated against the freshest copy of the conversation, inside the
    // mutation, so a concurrent sensitive turn is never missed.
    const next = detectCounterProfile({
      text,
      deskLabel: s.deskLabel,
      recent: s.messages.slice(-6).map((message) => ({ text: message.originalText })),
      currentProfileId: s.profileId,
    });
    if (next === s.profileId) return false;
    s.profileId = next;
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found or expired." }, { status: 404 });
  }
  if (rejection) return rejection;
  if (duplicateOf) {
    const duplicate: CounterMessage = duplicateOf;
    return NextResponse.json({
      message: toParticipantMessage(duplicate, from!),
      viaModel: duplicate.source !== "quick-phrase" && duplicate.source !== "confirm",
      duplicate: true,
    });
  }
  if (!from) {
    return NextResponse.json({ error: "Session authorisation required." }, { status: 401 });
  }
  const originalLang = sourceLangFor(session, from);
  const targetLang = targetLangFor(session, from);
  telemetry.recordLatency({ stage: "counter_admission", ms: Date.now() - receivedAt });

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
        return false;
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
      telemetry.recordLatency({ stage: "counter_server_total", ms: Date.now() - receivedAt });
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
    telemetry.recordLatency({ stage: "counter_server_total", ms: Date.now() - receivedAt });
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

  const effectiveProfileId = session.profileId;
  // Lack of a keyword match is not proof that an utterance is non-sensitive —
  // most supported languages cannot be exhaustively enumerated — so an
  // unresolved general session is kept out of the Learning Vault until a
  // concrete non-sensitive desk/conversation profile is established.
  const forceSensitiveRouting = effectiveProfileId === "general";
  // In Vercel Functions the current OIDC credential is request-scoped. It is
  // deliberately threaded only through server code and never persisted.
  const gatewayToken = request.headers.get("x-vercel-oidc-token")?.trim() || undefined;

  const result = await translateForCounter({
    text,
    sourceLang: originalLang,
    targetLang,
    recent,
    inputMode: source === "voice" ? "voice" : "text",
    from,
    rephrase: !!rephraseOf,
    action,
    deskLabel: session.deskLabel,
    profileId: effectiveProfileId,
    forceSensitiveRouting,
    routingKey: `counter:${code}`,
    gatewayToken,
  });

  telemetry.recordLatency({
    stage: "counter_translation",
    ms: result.latencyMs,
    provider: result.provider,
    model: result.model,
  });
  if (!result.ok) {
    telemetry.recordFailure("counter_translation_failed");
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "counter_translation_failed",
        provider: result.provider ?? null,
        latencyMs: result.latencyMs,
        gatewayRecoveryAvailable: Boolean(
          process.env.AI_GATEWAY_API_KEY?.trim() ||
            gatewayToken ||
            process.env.VERCEL_OIDC_TOKEN?.trim(),
        ),
        reason: result.error ?? "unknown",
      }),
    );
  }

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

  const persistStarted = Date.now();
  const persisted = await persistOnce(message);
  if (!persisted) {
    return NextResponse.json({ error: "Session not found or expired." }, { status: 404 });
  }
  telemetry.recordLatency({ stage: "counter_persist", ms: Date.now() - persistStarted });

  if (!persisted.duplicate && message.status === "done" && !forceSensitiveRouting) {
    // Nobody at the counter is waiting for this write. It runs once the
    // response is on its way rather than adding a Redis round trip to the
    // time the sender watches their message spin.
    const candidate = {
      sourceText: message.originalText,
      modelTranslation: message.translatedText,
      sourceLang: message.originalLang,
      targetLang: message.targetLang,
      profileId: effectiveProfileId,
      confidence: message.confidence,
      integrity: message.integrity,
      reviewFlags: message.reviewFlags,
    };
    afterResponse(() => recordLearningCandidate(candidate), "Learning Vault write");
  }

  telemetry.recordLatency({ stage: "counter_server_total", ms: Date.now() - receivedAt });
  return NextResponse.json({
    message: toParticipantMessage(persisted.message, from),
    viaModel: true,
    duplicate: persisted.duplicate,
    provider: result.provider,
    latencyMs: result.latencyMs,
  });
}
