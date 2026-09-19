/**
 * POST /api/stt/token — mint short-lived recogniser credentials.
 *
 * The browser must never hold an account key. This route returns either a
 * genuinely temporary key (Deepgram) or an ephemeral session token (OpenAI),
 * and for the keyless providers it simply reports which one to use.
 *
 * When nothing is configured it answers `demo` rather than erroring — an
 * unconfigured deployment still opens straight into a working console.
 *
 * GUARDED, and not optionally: this route mints credentials against a billed
 * Deepgram or OpenAI account. Unprotected it is a free key dispenser for
 * anyone who finds the URL, which is a worse hole than the interpretation
 * route — the credential outlives the request.
 */
import { NextResponse } from "next/server";
import { appEnv } from "@/lib/env";
import { guardInferenceRoute } from "@/lib/guard";
import { findLanguage } from "@/lib/languages";
import { whisperLanguage } from "@/providers/stt/language";
import {
  buildOpenAiTranscriptionConfig,
  openAiClientSecretBody,
} from "@/providers/stt/openai-transcription";
import type { SttCredentials } from "@/providers/stt/types";
import {
  COUNTER_TOKEN_HEADER,
  counterTokenFrom,
  participantForToken,
} from "@/counter/access";
import { normaliseCode } from "@/counter/codes";
import { counterStore } from "@/counter/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deepgram temporary keys are minted per session and expire quickly. */
const TEMP_KEY_TTL_SECONDS = 60 * 90; // one long service

export async function POST(request: Request) {
  const guarded = await guardInferenceRoute(request, {
    requireSession: true,
    deferredCredentialHeader: COUNTER_TOKEN_HEADER,
    maxBodyBytes: 1024,
    limits: [{ rule: "sttToken", by: "session" }, { rule: "sttToken", by: "address" }],
  });
  if (!guarded.ok) return guarded.response;

  const body = (guarded.body ?? {}) as {
    language?: unknown;
    guestLanguage?: unknown;
    usage?: unknown;
    code?: unknown;
  };
  const requestedLanguage =
    typeof body.language === "string" && findLanguage(body.language)
      ? body.language
      : "ko-KR";
  // The other language this session expects to hear. A live session is bilingual
  // by definition, and the ephemeral session must be minted with the same
  // expectation the websocket will then be configured with — otherwise the
  // recogniser is told two different things a moment apart.
  const requestedGuest =
    typeof body.guestLanguage === "string" && findLanguage(body.guestLanguage)
      ? body.guestLanguage
      : undefined;
  const suppliedCounterToken = counterTokenFrom(request);
  let counterTurn = body.usage === "counter" || !!suppliedCounterToken;
  if (counterTurn) {
    const code = typeof body.code === "string" ? normaliseCode(body.code) : null;
    const counterSession = code ? await counterStore().get(code) : undefined;
    if (!counterSession || !participantForToken(counterSession, suppliedCounterToken)) {
      return NextResponse.json(
        { error: "Counter session authorisation required." },
        { status: 401 },
      );
    }
    counterTurn = true;
  }

  // Read the PARSED environment. The raw values were read here directly, which
  // meant this route and the rest of the application could disagree about
  // which recogniser was configured — the launcher offering one the token
  // endpoint would not mint for.
  const env = appEnv();
  const provider = env.stt.provider;

  if (provider === "demo" || provider === "webspeech") {
    return NextResponse.json({ provider } satisfies SttCredentials);
  }

  if (provider === "deepgram") {
    const key = env.stt.deepgramKey;
    if (!key) return fallback("DEEPGRAM_API_KEY is not set.");

    const model = env.stt.deepgramModel;
    const temporary = await mintDeepgramKey(key);

    // Counter is a public, turn-based surface. Never send an account key to a
    // visitor's browser when a scoped temporary credential cannot be minted.
    if (counterTurn && !temporary) {
      return fallback("A short-lived Deepgram credential could not be issued.");
    }

    // A project without key-management scope can still stream; fall back to the
    // configured key rather than blocking the service. Documented in privacy.md.
    return NextResponse.json({
      provider,
      token: temporary ?? key,
      model,
      expiresAt: temporary ? Date.now() + TEMP_KEY_TTL_SECONDS * 1000 : undefined,
      ...(temporary ? {} : { ephemeral: false }),
    });
  }

  const key = env.stt.openaiKey;
  if (!key) return fallback("OPENAI_API_KEY is not set.");

  const model = env.stt.openaiModel;
  // Whisper selects a LANGUAGE, never a script. The registry knows the code it
  // accepts and what using it costs, so a `zh-TW` request is transcribed as
  // `zh` and SAYS SO rather than quietly returning Simplified characters and
  // reporting success.
  const whisper = whisperLanguage(requestedLanguage);
  const session = await mintOpenAiSession(
    key,
    buildOpenAiTranscriptionConfig({
      model,
      primaryLanguage: requestedLanguage,
      guestLanguage: requestedGuest,
    }),
  );

  if (counterTurn && !session) {
    return fallback("An ephemeral OpenAI transcription session could not be issued.");
  }

  return NextResponse.json({
    provider: "openai",
    token: session ?? key,
    model,
    ...(whisper && whisper.fidelity !== "native" ? { scriptFidelity: whisper.fidelity } : {}),
    ...(session ? {} : { ephemeral: false }),
  });
}

function fallback(reason: string) {
  return NextResponse.json({ provider: "demo", reason } satisfies SttCredentials & { reason: string });
}

/** Ask Deepgram for a scoped, expiring key for this session. */
async function mintDeepgramKey(accountKey: string): Promise<string | null> {
  const projectId = appEnv().stt.deepgramProjectId;
  if (!projectId) return null;
  try {
    const response = await fetch(
      `https://api.deepgram.com/v1/projects/${encodeURIComponent(projectId)}/keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Token ${accountKey}` },
        body: JSON.stringify({
          comment: "tong-yuck live session",
          scopes: ["usage:write"],
          time_to_live_in_seconds: TEMP_KEY_TTL_SECONDS,
        }),
      },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { key?: string };
    return data.key ?? null;
  } catch {
    return null;
  }
}

/**
 * Ask OpenAI for an ephemeral realtime transcription session token.
 *
 * The transcription config is built by the shared builder rather than assembled
 * here, so the session this mints and the session the websocket then updates
 * carry the same model, the same language expectation and the same field names.
 *
 * THE GA INTERFACE, NOT THE BETA ONE
 *
 * This used to POST `/v1/realtime/transcription_sessions` with an
 * `OpenAI-Beta: realtime=v1` header, which is the BETA realtime interface. That
 * interface's transcription config documents exactly three fields — `language`,
 * `model`, `prompt` — and lists three models, none of them this deployment's.
 * `languages` and `keywords`, the two fields that let a session say "this audio
 * contains more than one language" and "here is the vocabulary", exist only on
 * GA. Building them correctly and then handing them to the beta endpoint would
 * have been a fix that could not work.
 *
 * So: the GA client-secret endpoint, no beta header, and the session
 * configuration nested the way GA nests it — `session.audio.input`, with the
 * PCM format as an object rather than the old `pcm16` string. The websocket's
 * own `transcription_session.update` keeps its flat field names, because that
 * event is specified flat on GA too.
 */
async function mintOpenAiSession(
  apiKey: string,
  transcription: ReturnType<typeof buildOpenAiTranscriptionConfig>,
): Promise<string | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(openAiClientSecretBody(transcription)),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { value?: string };
    return data.value ?? null;
  } catch {
    return null;
  }
}
