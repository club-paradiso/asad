/**
 * POST /api/stt/hf — one short Counter utterance through HF ASR.
 *
 * The browser never receives the HF token. Audio stays in request memory only:
 * it is not put in the Counter store, Learning Vault, telemetry, or logs.
 */
import { NextResponse } from "next/server";
import { appEnv } from "@/lib/env";
import { guardInferenceRoute } from "@/lib/guard";
import { normaliseCode } from "@/counter/codes";
import { counterStore } from "@/counter/store";
import { isSensitiveCounterProfile } from "@/counter/profiles";
import { findLanguage } from "@/counter/languages";
import { MAX_COUNTER_UTTERANCE_BYTES } from "@/providers/stt/audio";
import {
  COUNTER_TOKEN_HEADER,
  counterTokenFrom,
  participantForToken,
} from "@/counter/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 24 seconds PCM16 plus WAV and base64/JSON framing. Kept below Vercel's
// serverless request limits while giving a Counter turn ample room.
const MAX_BODY_BYTES = 1_100_000;
const HF_TIMEOUT_MS = 32_000;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

type HfPayload = { audio?: unknown; language?: unknown; code?: unknown };

export async function POST(request: Request) {
  const guarded = await guardInferenceRoute(request, {
    requireSession: true,
    deferredCredentialHeader: COUNTER_TOKEN_HEADER,
    maxBodyBytes: MAX_BODY_BYTES,
    limits: [{ rule: "sttHf", by: "session" }, { rule: "sttHf", by: "address" }],
  });
  if (!guarded.ok) return guarded.response;

  const body = guarded.body as HfPayload;
  const audio = decodeAudio(body.audio);
  if (!audio) return error(400, "Invalid audio.");
  if (audio.byteLength > MAX_COUNTER_UTTERANCE_BYTES + 44) {
    return error(413, "Voice input is too long. Please use a shorter turn or type your message.");
  }
  const language = typeof body.language === "string" && findLanguage(body.language)
    ? body.language
    : "en-US";

  // Do not trust a browser-supplied profile. Look up the transient session and
  // fail closed if it is unavailable: a generic provider must never receive a
  // refugee or judicial utterance through a forged/general profile claim.
  const code = typeof body.code === "string" ? normaliseCode(body.code) : null;
  const session = code ? await counterStore().get(code) : undefined;
  if (!session) return error(403, "Voice fallback is not available for this session.");
  if (!participantForToken(session, counterTokenFrom(request))) {
    return error(401, "Counter session authorisation required.");
  }
  if (isSensitiveCounterProfile(session.profileId)) {
    return error(403, "Voice fallback is not available for this service.");
  }

  const env = appEnv();
  if (!env.stt.hfToken) {
    return error(503, "Voice fallback is not configured. Please type your message.");
  }

  const result = await requestHfTranscription({
    token: env.stt.hfToken,
    model: env.stt.hfModel,
    audio,
    language,
  });
  if (!result.ok) return error(result.status, result.message, result.retryAfter);
  return NextResponse.json({ text: result.text }, { headers: { "cache-control": "no-store" } });
}

export function decodeAudio(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length < 60 || value.length % 4 !== 0 || !BASE64_RE.test(value)) {
    return null;
  }
  try {
    const bytes = Buffer.from(value, "base64");
    // Buffer accepts a surprising amount of malformed base64; canonical round
    // trip validation avoids forwarding a different payload than was checked.
    if (bytes.toString("base64") !== value) return null;
    return new Uint8Array(bytes);
  } catch {
    return null;
  }
}

export function parseHfTranscription(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" && text.trim() ? text.trim().slice(0, 4000) : null;
}

export async function requestHfTranscription(input: {
  token: string;
  model: string;
  audio: Uint8Array;
  language: string;
  fetcher?: typeof fetch;
}): Promise<{ ok: true; text: string } | { ok: false; status: number; message: string; retryAfter?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);
  try {
    // Raw WAV is the documented ASR request format when no optional parameters
    // are sent. Whisper auto-detects language; preserving that avoids wrongly
    // forcing regional language tags into a provider-specific schema.
    // Copy into an ArrayBuffer, rather than forwarding a Buffer/typed-array
    // view whose backing store could be shared. It also keeps the Fetch body
    // type portable across Node and Vercel's runtime typings.
    const requestBody = new Uint8Array(input.audio.byteLength);
    requestBody.set(input.audio);
    const response = await (input.fetcher ?? fetch)(
      `https://router.huggingface.co/hf-inference/models/${encodeURIComponent(input.model)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.token}`,
          "content-type": "audio/wav",
          accept: "application/json",
        },
        body: requestBody.buffer,
        signal: controller.signal,
        cache: "no-store",
      },
    );
    const json = await response.json().catch(() => null);
    const text = response.ok ? parseHfTranscription(json) : null;
    if (text) return { ok: true, text };
    if (response.status === 429) {
      return { ok: false, status: 429, message: "Voice fallback is busy. Please try again shortly or type your message.", retryAfter: response.headers.get("retry-after") ?? undefined };
    }
    if (response.status === 503) {
      return { ok: false, status: 503, message: "Voice fallback is warming up. Please try again shortly or type your message." };
    }
    // Billing/quota/provider details are intentionally not returned. They can
    // reveal account state and are not actionable to a visitor.
    return { ok: false, status: response.status >= 400 ? 503 : 502, message: "Voice fallback could not transcribe this turn. Please try again or type your message." };
  } catch {
    return { ok: false, status: 504, message: "Voice fallback took too long. Please try again or type your message." };
  } finally {
    clearTimeout(timer);
  }
}

function error(status: number, message: string, retryAfter?: string) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "cache-control": "no-store", ...(retryAfter ? { "retry-after": retryAfter } : {}) } },
  );
}
