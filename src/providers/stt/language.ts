/**
 * Provider-specific STT language tags.
 *
 * The product uses BCP-47 tags because the UI needs region/script distinctions,
 * but speech vendors do not accept the same set of tags. The translation lives
 * in the registry (`@/languages/registry`); these helpers only add the
 * provider boundary's default: no language means Korean, as it did throughout
 * the MVP.
 */
import { sttLanguageFor, whisperPromptFor } from "@/languages/registry";

const DEFAULT_LANGUAGE = "ko-KR";

/**
 * Deepgram Nova-3 language code, or null for a language Nova-3 does not
 * support so Counter Mode can fall back to browser speech immediately.
 */
export function deepgramLanguage(language: string | undefined): string | null {
  return sttLanguageFor("deepgram", language ?? DEFAULT_LANGUAGE);
}

/**
 * Browser SpeechRecognition tag (Google exposes Filipino as fil-PH, for one).
 * `null` when the registry says the browser recogniser must not receive the
 * language at all, or when the tag is not a registry language.
 */
export function webSpeechLanguage(language: string | undefined): string | null {
  return sttLanguageFor("webspeech", language ?? DEFAULT_LANGUAGE);
}

/** Whisper-family base code for OpenAI realtime transcription, or null. */
export function openaiTranscriptionLanguage(language: string | undefined): string | null {
  return sttLanguageFor("openai", language ?? DEFAULT_LANGUAGE);
}

/**
 * Whisper cannot be told a script through its language code — `zh` alone lets
 * the model pick Simplified or Traditional. The registry carries a prompt in
 * the wanted script for the languages where that matters.
 */
export function whisperScriptPrompt(language: string | undefined): string | undefined {
  return whisperPromptFor(language ?? DEFAULT_LANGUAGE);
}
