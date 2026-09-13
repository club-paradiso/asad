/**
 * Provider-specific STT language tags.
 *
 * The product uses BCP-47 tags because the UI needs region/script distinctions,
 * but speech vendors do not accept the same set of tags. Keep that translation
 * at the provider boundary instead of throwing away region information globally.
 *
 * The tables these functions used to carry are gone: every mapping now comes
 * from the one language registry, so a language cannot be offered in a picker
 * and simultaneously be missing from a recogniser map.
 */
import { findLanguage } from "@/lib/languages";

/** The tag the app falls back to when a caller supplies none. */
const DEFAULT_LANGUAGE = "ko-KR";

/**
 * Deepgram Nova-3 language codes.
 *
 * Region/script variants are preserved where Deepgram has distinct models
 * (notably Simplified vs Traditional Chinese). Returns null for languages
 * Nova-3 does not support, so a caller can fall back immediately rather than
 * opening a socket that will be refused.
 */
export function deepgramLanguage(language: string | undefined): string | null {
  if (!language) return DEFAULT_LANGUAGE;
  return findLanguage(language)?.stt.deepgram?.code ?? null;
}

/**
 * Browser SpeechRecognition wants BCP-47. Most app tags pass through, but
 * Google's browser speech backend commonly exposes Filipino as fil-PH rather
 * than the older tl-PH tag used by the product/model layer — the registry
 * records that, this only reads it.
 */
export function webSpeechLanguage(language: string | undefined): string {
  if (!language) return DEFAULT_LANGUAGE;
  return findLanguage(language)?.stt.webspeech?.code ?? language;
}

/**
 * The Whisper-family code (OpenAI realtime transcription, Hugging Face
 * fallback), together with what is lost by using it.
 *
 * Whisper selects a LANGUAGE, never a script, so a tag whose meaning is a
 * script variant cannot be honoured. Returning the fidelity alongside the code
 * is what lets `/api/stt/token` stop claiming it can.
 */
export function whisperLanguage(
  language: string | undefined,
): { code: string; fidelity: "native" | "experimental" | "variant-lossy" } | null {
  const coverage = findLanguage(language ?? DEFAULT_LANGUAGE)?.stt.whisper;
  return coverage ? { code: coverage.code, fidelity: coverage.fidelity } : null;
}
