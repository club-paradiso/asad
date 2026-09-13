/**
 * What each recogniser can actually do, per language.
 *
 * Counter Mode used to discover this the expensive way: fetch a credential,
 * open a socket, wait for the provider to reject the language tag, time out,
 * and only then fall back. That is several seconds of a visitor standing at a
 * desk watching a spinner, and it happened precisely for the lower-resource
 * languages that can least afford it.
 *
 * It also used to be possible to *claim* a language was supported when nothing
 * in the stack could transcribe it. Offering a microphone that cannot work is
 * worse than offering no microphone: the visitor speaks, nothing happens, and
 * they have no way to tell whether they were heard.
 *
 * So capability is declared, not discovered — in the language registry, where
 * every provider slot is either an identifier or an explicit `null`:
 *
 *   native        the vendor lists this language and it is in ordinary use
 *   experimental  the vendor accepts the tag but quality is not established
 *   fallback-only reachable only through a slower batch path
 *   unsupported   do not send this language to this provider at all
 */
import { resolveLanguage, sttLanguageFor } from "@/languages/registry";

export type SttLanguageSupport = "native" | "experimental" | "fallback-only" | "unsupported";

/** Recognisers Counter Mode can reach, in the order it prefers them. */
export type CounterSttProvider = "deepgram" | "openai" | "webspeech" | "hf";

/**
 * Whisper languages where the training data is thin enough that Counter Mode
 * should not present the result as a confident recognition. They still work —
 * they are simply not on the same footing as Korean or English.
 */
const WHISPER_LOW_RESOURCE = new Set(["km", "my", "mn", "ne", "si", "lo", "ps", "tg", "sd"]);

export function sttLanguageSupport(
  provider: CounterSttProvider,
  language: string | undefined,
): SttLanguageSupport {
  const known = resolveLanguage(language);
  if (!known) return "unsupported";

  switch (provider) {
    case "deepgram":
      return sttLanguageFor("deepgram", known.id) ? "native" : "unsupported";
    case "openai": {
      const code = sttLanguageFor("openai", known.id);
      if (!code) return "unsupported";
      return WHISPER_LOW_RESOURCE.has(code) ? "experimental" : "native";
    }
    case "webspeech":
      // The registry flag is the product's own record of which languages the
      // browser recogniser handles well enough to offer; a language the
      // browser must never receive has no tag at all.
      return known.browserSpeechOffered && sttLanguageFor("webspeech", known.id)
        ? "native"
        : "unsupported";
    case "hf":
      if (!sttLanguageFor("hf", known.id)) return "unsupported";
      // Batch-only by construction: one utterance is uploaded after it ends,
      // so there are no interim results however good the model is.
      return "fallback-only";
  }
}

/** Cloud streaming recognisers that can serve this language at all. */
export function cloudSttCandidates(language: string | undefined): CounterSttProvider[] {
  return (["deepgram", "openai"] as const).filter(
    (provider) => sttLanguageSupport(provider, language) !== "unsupported",
  );
}

const ORDER: CounterSttProvider[] = ["deepgram", "openai", "webspeech", "hf"];

/** Every recogniser that could transcribe this language, best path first. */
export function counterSpeechPlan(
  language: string | undefined,
): Array<{ provider: CounterSttProvider; support: SttLanguageSupport }> {
  return ORDER.map((provider) => ({
    provider,
    support: sttLanguageSupport(provider, language),
  })).filter((entry) => entry.support !== "unsupported");
}

const RANK: Record<SttLanguageSupport, number> = {
  native: 3,
  experimental: 2,
  "fallback-only": 1,
  unsupported: 0,
};

/**
 * The best speech support this language has anywhere in the stack.
 *
 * `unsupported` is the honest answer for a language no configured recogniser
 * covers, and the Composer uses it to offer typing as the normal path rather
 * than a microphone that cannot succeed.
 */
export function counterVoiceSupport(language: string | undefined): SttLanguageSupport {
  return counterSpeechPlan(language).reduce<SttLanguageSupport>(
    (best, entry) => (RANK[entry.support] > RANK[best] ? entry.support : best),
    "unsupported",
  );
}

/** Whether Counter Mode should offer a microphone for this language at all. */
export const counterVoiceOffered = (language: string | undefined): boolean =>
  counterVoiceSupport(language) !== "unsupported";
