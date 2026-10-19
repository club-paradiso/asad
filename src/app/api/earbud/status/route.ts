import { NextResponse } from "next/server";
import { appEnv } from "@/lib/env";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Capability booleans only; never disclose keys or billing details. */
export async function GET() {
  const env = appEnv();
  const key = env.llm.providers.gemini.apiKey;
  const enabled = !!key && !env.llm.paidTier.has("gemini") && !!env.access.key;
  return NextResponse.json({
    translation: {
      available: enabled,
      model: "gemini-3.1-flash-lite",
      limitedFreeTier: true,
      note: "Free-tier access has provider rate limits. API key configuration cannot prove billing is disabled.",
    },
    tts: {
      available: enabled && process.env.ASAD_EARBUD_GEMINI_TTS === "1",
      model: "gemini-2.5-flash-preview-tts",
      note: "Optional cloud-generated Korean audio; must explicitly opt in. Not guaranteed unbilled on paid Gemini projects.",
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
