/**
 * POST /api/stt/token — mint short-lived recogniser credentials.
 *
 * The browser must never hold an account key. This route returns either a
 * genuinely temporary key (Deepgram) or an ephemeral session token (OpenAI),
 * and for the keyless providers it simply reports which one to use.
 *
 * When nothing is configured it answers `demo` rather than erroring — an
 * unconfigured deployment still opens straight into a working console.
 */
import { NextResponse } from "next/server";
import type { SttCredentials, SttProviderId } from "@/providers/stt/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deepgram temporary keys are minted per session and expire quickly. */
const TEMP_KEY_TTL_SECONDS = 60 * 90; // one long service

const isProviderId = (value: string): value is SttProviderId =>
  value === "demo" || value === "webspeech" || value === "deepgram" || value === "openai";

export async function POST() {
  const requested = (process.env.STT_PROVIDER ?? "demo").trim().toLowerCase();
  const provider: SttProviderId = isProviderId(requested) ? requested : "demo";

  if (provider === "demo" || provider === "webspeech") {
    return NextResponse.json({ provider } satisfies SttCredentials);
  }

  if (provider === "deepgram") {
    const key = process.env.DEEPGRAM_API_KEY?.trim();
    if (!key) return fallback("DEEPGRAM_API_KEY is not set.");

    const model = process.env.DEEPGRAM_STT_MODEL?.trim() || "nova-3";
    const temporary = await mintDeepgramKey(key);

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

  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return fallback("OPENAI_API_KEY is not set.");

  const model = process.env.OPENAI_STT_MODEL?.trim() || "gpt-live-transcribe";
  const session = await mintOpenAiSession(key, model);

  return NextResponse.json({
    provider: "openai",
    token: session ?? key,
    model,
    ...(session ? {} : { ephemeral: false }),
  });
}

function fallback(reason: string) {
  return NextResponse.json({ provider: "demo", reason } satisfies SttCredentials & { reason: string });
}

/** Ask Deepgram for a scoped, expiring key for this session. */
async function mintDeepgramKey(accountKey: string): Promise<string | null> {
  const projectId = process.env.DEEPGRAM_PROJECT_ID?.trim();
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

/** Ask OpenAI for an ephemeral realtime transcription session token. */
async function mintOpenAiSession(apiKey: string, model: string): Promise<string | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/transcription_sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
      body: JSON.stringify({
        input_audio_format: "pcm16",
        input_audio_transcription: { model, language: "ko" },
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { client_secret?: { value?: string } };
    return data.client_secret?.value ?? null;
  } catch {
    return null;
  }
}
