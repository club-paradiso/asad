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
 * So capability is declared, not discovered — and it is declared once, in the
 * language registry, which this module only reads:
 *
 *   native        the vendor lists this language and it is in ordinary use
 *   experimental  the vendor accepts the tag but quality is not established
 *   variant-lossy the vendor accepts only the BASE language, so the script the
 *                 user asked for is not what comes back
 *   fallback-only reachable only through a slower batch path
 *   unsupported   do not send this language to this provider at all
 *
 * `variant-lossy` exists because of a real failure rather than a theoretical
 * one. Whisper's transcription API selects a language, never a script: ask it
 * for `zh` and a visitor who chose 中文（繁體） is transcribed in Simplified
 * characters and told it worked. The rank table below puts such a path behind
 * any recogniser that preserves the script, for every language with that shape
 * — not for Chinese as a special case.
 */
import { findLanguage } from "@/lib/languages";
import { deepgramLanguage, whisperLanguage } from "./language";

export type SttLanguageSupport =
  | "native"
  | "experimental"
  | "variant-lossy"
  | "fallback-only"
  | "unsupported";

/** Recognisers Counter Mode can reach, in the order it prefers them. */
export type CounterSttProvider = "deepgram" | "openai" | "webspeech" | "hf";

export function sttLanguageSupport(
  provider: CounterSttProvider,
  language: string | undefined,
): SttLanguageSupport {
  if (!language?.trim() || !findLanguage(language)) return "unsupported";

  switch (provider) {
    case "deepgram":
      return deepgramLanguage(language) ? "native" : "unsupported";
    case "openai": {
      const whisper = whisperLanguage(language);
      return whisper ? whisper.fidelity : "unsupported";
    }
    case "webspeech":
      // The registry's record of which languages the browser recogniser handles
      // well enough to offer.
      return findLanguage(language)?.stt.webspeech ? "native" : "unsupported";
    case "hf":
      // Batch-only by construction: one utterance is uploaded after it ends,
      // so there are no interim results however good the model is.
      return whisperLanguage(language) ? "fallback-only" : "unsupported";
  }
}

/** Cloud streaming recognisers that can serve this language at all. */
export function cloudSttCandidates(language: string | undefined): CounterSttProvider[] {
  return (["deepgram", "openai"] as const).filter(
    (provider) => sttLanguageSupport(provider, language) !== "unsupported",
  );
}

const ORDER: CounterSttProvider[] = ["deepgram", "openai", "webspeech", "hf"];

const RANK: Record<SttLanguageSupport, number> = {
  native: 4,
  experimental: 3,
  "variant-lossy": 2,
  "fallback-only": 1,
  unsupported: 0,
};

/**
 * Every recogniser that could transcribe this language, best path first.
 *
 * ORDER is the default preference — streaming before batch, cloud before
 * browser — with one override: a path that loses the requested script sinks
 * below any path that preserves it. Getting the words in the wrong script
 * quickly is not better than getting them in the right one.
 */
export function counterSpeechPlan(
  language: string | undefined,
): Array<{ provider: CounterSttProvider; support: SttLanguageSupport }> {
  const entries = ORDER.map((provider, position) => ({
    provider,
    support: sttLanguageSupport(provider, language),
    position,
  })).filter((entry) => entry.support !== "unsupported");

  const anyFaithful = entries.some((entry) => entry.support !== "variant-lossy");
  return entries
    .sort((a, b) => {
      if (anyFaithful) {
        const lossy = Number(a.support === "variant-lossy") - Number(b.support === "variant-lossy");
        if (lossy !== 0) return lossy;
      }
      return a.position - b.position;
    })
    .map(({ provider, support }) => ({ provider, support }));
}

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

/**
 * Whether the configured cloud recogniser should be skipped in favour of the
 * browser's, for this language.
 *
 * True in exactly one situation: the cloud path cannot carry the script the
 * user asked for and the browser path can. Everything else keeps the ordinary
 * cloud-first preference, because streaming interim results are worth more
 * than anything the browser recogniser offers.
 */
export function preferBrowserForScript(input: {
  language: string | undefined;
  cloud: CounterSttProvider | null;
  browserAvailable: boolean;
}): boolean {
  if (!input.cloud || !input.browserAvailable) return false;
  if (sttLanguageSupport(input.cloud, input.language) !== "variant-lossy") return false;
  return sttLanguageSupport("webspeech", input.language) === "native";
}
