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
import { appEnv } from "@/lib/env";
import { capabilitiesFor, trainsOnFreeTier } from "@/providers/llm/capabilities";
import { llmRouter } from "@/providers/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AppConfig {
  stt: { configured: string; cloudAvailable: boolean };
  llm: {
    configured: string;
    modelAvailable: boolean;
    routingMode: string;
    /**
     * Providers in the active chain whose free tier may use submitted content
     * to improve their products. Labels and notes only — never keys.
     */
    freeTierDisclosure: Array<{ label: string; note: string }>;
  };
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

  const env = appEnv();
  const plan = llmRouter().plan();
  const freeTierDisclosure = plan.chain
    .filter((id) => id !== "local" && trainsOnFreeTier(id))
    .map((id) => ({ label: capabilitiesFor(id).label, note: capabilitiesFor(id).privacyNote }));

  const config: AppConfig = {
    stt: { configured: stt, cloudAvailable },
    llm: {
      configured: llm,
      modelAvailable,
      routingMode: env.llm.routingMode,
      freeTierDisclosure,
    },
    bible: {
      configured: bible,
      textAvailable,
      translation: process.env.BIBLE_TRANSLATION?.trim() || "WEB",
    },
  };

  return NextResponse.json(config);
}
