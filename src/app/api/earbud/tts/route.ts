import { NextResponse } from "next/server";
import { appEnv } from "@/lib/env";
import { guardInferenceRoute } from "@/lib/guard";
import { pcm16ToWav } from "@/features/earbud/audio-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MODEL = "gemini-2.5-flash-preview-tts";

/** Cloud TTS is opt-in, gated, limited, and never falls back to a paid vendor. */
export async function POST(request: Request) {
  const guarded = await guardInferenceRoute(request, {
    requireSession: true, maxBodyBytes: 2048,
    limits: [
      { rule: "earbudTtsSession", by: "session" },
      { rule: "earbudTtsAddress", by: "address" },
    ],
  });
  if (!guarded.ok) return guarded.response;
  const text = typeof guarded.body === "object" && guarded.body !== null
    ? (guarded.body as Record<string, unknown>).text : null;
  if (typeof text !== "string" || !text.trim() || text.length > 260) {
    return NextResponse.json({ error: "Short Korean text is required." }, { status: 400 });
  }
  const env = appEnv();
  const key = env.llm.providers.gemini.apiKey;
  if (
    process.env.ASAD_EARBUD_GEMINI_TTS !== "1" || !key ||
    env.llm.paidTier.has("gemini") || !env.access.key
  ) {
    return NextResponse.json({ error: "Optional cloud TTS is disabled." }, { status: 503 });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `Read this Korean sentence clearly without changing any words: ${text}` }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
          },
        }),
      },
    );
    if (!response.ok) {
      return NextResponse.json({ error: response.status === 429 ? "TTS free quota exhausted." : "TTS service unavailable." }, { status: response.status === 429 ? 429 : 503 });
    }
    const payload = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
    };
    const audio = payload.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!audio?.data || audio.data.length > 6_000_000) {
      return NextResponse.json({ error: "TTS response missing audio." }, { status: 502 });
    }
    const raw = Buffer.from(audio.data, "base64");
    const wav = audio.mimeType?.includes("wav") || raw.subarray(0, 4).toString() === "RIFF"
      ? raw : Buffer.from(pcm16ToWav(new Uint8Array(raw)));
    return new NextResponse(new Uint8Array(wav), {
      headers: {
        "content-type": "audio/wav", "Cache-Control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "TTS audio request interrupted." }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
