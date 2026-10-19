import { appEnv } from "@/lib/env";

/**
 * Never infer free-tier status from the mere existence of an Azure key.
 * Require deployment-owner affirmative flags in addition to the protected
 * preview gate. Flags document operator responsibility, not a billing lock.
 */
export function ensembleConfig() {
  const env = appEnv();
  const secured = !!env.access.key;
  const index = secured && process.env.ASAD_EARBUD_ENSEMBLE === "1"
    && process.env.ASAD_INDEX_TRANSLATE_PUBLIC === "1";
  const azure = secured && process.env.ASAD_EARBUD_ENSEMBLE === "1"
    && process.env.ASAD_AZURE_F0_CONFIRMED === "1"
    && !!process.env.AZURE_TRANSLATOR_KEY?.trim();
  const judge = index && azure
    && process.env.ASAD_EARBUD_GEMINI_JUDGE === "1"
    && !!env.llm.providers.gemini.apiKey
    && !env.llm.paidTier.has("gemini");
  return {
    enabled: index && azure,
    index, azure, judge,
    azureKey: azure ? process.env.AZURE_TRANSLATOR_KEY!.trim() : undefined,
    azureRegion: process.env.AZURE_TRANSLATOR_REGION?.trim() || undefined,
    geminiKey: judge ? env.llm.providers.gemini.apiKey : undefined,
  };
}
