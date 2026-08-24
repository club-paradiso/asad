/**
 * GET /api/config — what this deployment can actually do.
 *
 * The console asks once at startup so it can present honest options: if no
 * cloud recogniser is configured, do not offer one; if no LLM is configured,
 * say that English assistance will be rule-based rather than letting the
 * interpreter discover it live.
 *
 * Only capability flags are exposed. No keys, no ids, no endpoints.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AppConfig {
  stt: { configured: string; cloudAvailable: boolean };
  llm: { configured: string; modelAvailable: boolean };
  bible: { configured: string; textAvailable: boolean; translation: string };
}

export async function GET() {
  const stt = (process.env.STT_PROVIDER ?? "demo").trim().toLowerCase();
  const llm = (process.env.LLM_PROVIDER ?? "mock").trim().toLowerCase();
  const bible = (process.env.BIBLE_PROVIDER ?? "reference-only").trim().toLowerCase();

  const cloudAvailable =
    (stt === "deepgram" && !!process.env.DEEPGRAM_API_KEY?.trim()) ||
    (stt === "openai" && !!process.env.OPENAI_API_KEY?.trim());

  const modelAvailable = llm !== "mock" && !!process.env.LLM_API_KEY?.trim();

  const textAvailable =
    bible === "public-domain" ||
    (bible === "api-bible" && !!process.env.BIBLE_API_KEY?.trim() && !!process.env.BIBLE_ID?.trim());

  const config: AppConfig = {
    stt: { configured: stt, cloudAvailable },
    llm: { configured: llm, modelAvailable },
    bible: {
      configured: bible,
      textAvailable,
      translation: process.env.BIBLE_TRANSLATION?.trim() || "WEB",
    },
  };

  return NextResponse.json(config);
}
