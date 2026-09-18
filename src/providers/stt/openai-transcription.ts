/**
 * What each OpenAI transcription model is actually configured with.
 *
 * THE BUG THIS EXISTS TO FIX
 *
 * The deployment's default model is `gpt-live-transcribe`, and the product was
 * sending it `language` — singular — plus a hand-written English paragraph
 * asking it, in prose, to expect a second language and some technical terms.
 *
 * That model does not take `language`. It takes `languages`, a list, and it
 * takes `keywords`, a list of literal terms, and OpenAI's migration guidance is
 * explicit that `language` and `languages` must not both be sent. So the one
 * parameter that exists precisely to say "this recording contains more than one
 * language" was never sent, and the multilingual hint was being simulated in
 * prose to a model that had a field for it.
 *
 * TWO FAMILIES, DECLARED RATHER THAN SNIFFED
 *
 *   gpt-transcribe family   `languages` (ISO 639-1 list) · `keywords` · `prompt`
 *   whisper family          `language`  (one ISO 639-1)  · `prompt`
 *
 * Membership is an explicit list, not `model.includes("live")`. A substring
 * test is a guess about a vendor's naming convention, and this file exists
 * because a guess about a vendor's contract had already cost us the feature.
 *
 * An unrecognised model — a deployer's override, or one released after this was
 * written — is treated as the whisper family: `language` + `prompt` is the older
 * and more widely accepted contract, so it is the safer thing to send at a
 * model whose capabilities we cannot look up. `/diagnostics` reports which
 * family a configured model resolved to, so that choice is visible rather than
 * silent.
 */
import { whisperLanguage } from "./language";
import { truncateTerm } from "@/lib/code-switch";
import { languageName } from "@/lib/languages";

export type OpenAiTranscriptionFamily = "gpt-transcribe" | "whisper";

export interface OpenAiTranscriptionCapabilities {
  family: OpenAiTranscriptionFamily;
  /** Accepts `languages: string[]` — a genuine multilingual hint. */
  expectedLanguages: boolean;
  /** Accepts `language: string`. Mutually exclusive with `expectedLanguages`. */
  singleLanguage: boolean;
  /** Accepts `keywords: string[]` — literal vocabulary rather than prose. */
  keywords: boolean;
  /** Accepts `prompt: string` — free-form context. Most, but not all, do. */
  prompt: boolean;
  /**
   * Accepts a `turn_detection` block. False for `gpt-realtime-whisper`, whose
   * transcription sessions document that turn detection must be null because
   * VAD is not supported.
   */
  turnDetection: boolean;
}

/**
 * Models documented to take the newer context fields.
 *
 * Dated snapshots (`gpt-transcribe-2026-07-28`) resolve by prefix, because a
 * snapshot of a model has that model's contract.
 */
const GPT_TRANSCRIBE_MODELS = ["gpt-live-transcribe", "gpt-transcribe"] as const;

/**
 * The realtime Whisper model, which is its own third case.
 *
 * It takes `language` like the rest of the Whisper family, but OpenAI documents
 * two things about it that nothing else in the family shares: `prompt` is not
 * supported in GA realtime sessions, and turn detection must be null because it
 * does no VAD. Both are listed here so a deployer who configures it gets a
 * request it can actually accept rather than a socket that rejects the opening
 * message.
 */
const REALTIME_WHISPER_MODELS = ["gpt-realtime-whisper"] as const;

/** How many literal terms one session may hand the recogniser. */
export const MAX_KEYWORDS = 40;
/** Keywords are single-line tokens; a sentence is a prompt, not a keyword. */
export const MAX_KEYWORD_CHARS = 60;

export function openAiTranscriptionCapabilities(
  model: string | undefined,
): OpenAiTranscriptionCapabilities {
  const id = model?.trim().toLowerCase() ?? "";
  if (GPT_TRANSCRIBE_MODELS.some((known) => id.startsWith(known))) {
    return {
      family: "gpt-transcribe",
      expectedLanguages: true,
      singleLanguage: false,
      keywords: true,
      prompt: true,
      turnDetection: true,
    };
  }
  if (REALTIME_WHISPER_MODELS.some((known) => id.startsWith(known))) {
    return {
      family: "whisper",
      expectedLanguages: false,
      singleLanguage: true,
      keywords: false,
      prompt: false,
      turnDetection: false,
    };
  }
  return {
    family: "whisper",
    expectedLanguages: false,
    singleLanguage: true,
    keywords: false,
    prompt: true,
    turnDetection: true,
  };
}

export interface OpenAiTranscriptionInput {
  model: string;
  /** BCP-47 tag of the language the speaker is expected to speak. */
  primaryLanguage: string | undefined;
  /** BCP-47 tag of the other language this session expects to hear. */
  guestLanguage?: string;
  /** Literal terms — names, acronyms, product and domain vocabulary. */
  keywords?: readonly string[];
}

export interface OpenAiTranscriptionConfig {
  model: string;
  language?: string;
  languages?: string[];
  keywords?: string[];
  prompt?: string;
}

/**
 * Sanitise one keyword.
 *
 * OpenAI documents that a keyword is one line and may not contain `<`, `>`, a
 * carriage return or a line feed. Enforced here rather than trusted, because
 * the list is assembled from a prep sheet a person typed.
 */
const cleanKeyword = (value: string): string =>
  truncateTerm(
    value.replace(/[<>\r\n]/g, " ").replace(/\s+/g, " ").trim(),
    MAX_KEYWORD_CHARS,
  );

/**
 * The ISO 639-1 code this vendor accepts for a tag, or nothing.
 *
 * Deliberately has no "just send the base subtag" fallback. The registry's
 * Whisper coverage is the product's one declaration of whether OpenAI can
 * transcribe a language at all, and it is null for Uyghur specifically because
 * the model is not trained on it — passing `ug` does not produce Uyghur, it
 * produces fluent text in whichever neighbouring language the decoder settled
 * on. Deriving a code from the tag anyway would hand the vendor a parameter it
 * cannot honour and call the result support. If a newer OpenAI model genuinely
 * covers more languages than Whisper does, that is a registry change with a
 * source behind it, not an inference made here.
 */
const vendorCode = (tag: string | undefined): string | undefined =>
  whisperLanguage(tag)?.code;

/**
 * Build the `input_audio_transcription` object for one session.
 *
 * Emits ONLY fields documented for the resolved family. Nothing here ever sends
 * both `language` and `languages`, and nothing sends `keywords` to a model that
 * has no such field.
 */
export function buildOpenAiTranscriptionConfig(
  input: OpenAiTranscriptionInput,
): OpenAiTranscriptionConfig {
  const caps = openAiTranscriptionCapabilities(input.model);
  const primary = vendorCode(input.primaryLanguage);
  const guest = input.guestLanguage ? vendorCode(input.guestLanguage) : undefined;
  const bilingual = !!guest && guest !== primary;

  const config: OpenAiTranscriptionConfig = { model: input.model };

  if (caps.expectedLanguages) {
    // The whole point of the field: "a list of expected input languages when
    // the recording may contain more than one language". A live interpretation
    // session is that by definition.
    const languages = [primary, bilingual ? guest : undefined].filter(
      (code): code is string => !!code,
    );
    if (languages.length) config.languages = languages;
  } else if (caps.singleLanguage && primary) {
    config.language = primary;
  }

  if (caps.keywords) {
    const keywords = (input.keywords ?? [])
      .map(cleanKeyword)
      .filter((keyword) => keyword.length >= 2)
      .slice(0, MAX_KEYWORDS);
    if (keywords.length) config.keywords = keywords;
  }

  if (caps.prompt) {
    const prompt = transcriptionPrompt({
      caps,
      primaryLanguage: input.primaryLanguage,
      guestLanguage: bilingual ? input.guestLanguage : undefined,
      keywords: caps.keywords ? [] : (input.keywords ?? []),
    });
    if (prompt) config.prompt = prompt;
  }

  return config;
}

/**
 * Free-form context, kept to what the structured fields cannot express.
 *
 * On the newer family that is almost nothing: `languages` already states the
 * mixture and `keywords` already carries the vocabulary, so the prompt only
 * says the one thing neither field does — that guest spans must survive as
 * themselves rather than be transliterated into the dominant language, which is
 * the exact failure this whole area exists to prevent.
 *
 * On the whisper family the prompt is the only lever there is, so it carries
 * the terminology too.
 */
function transcriptionPrompt(input: {
  caps: OpenAiTranscriptionCapabilities;
  primaryLanguage: string | undefined;
  guestLanguage?: string;
  keywords: readonly string[];
}): string | undefined {
  const lines: string[] = [];
  if (input.guestLanguage) {
    const guest = languageName(input.guestLanguage);
    const primary = languageName(input.primaryLanguage ?? "ko-KR");
    lines.push(
      `The speaker mixes ${guest} words, names and technical terms into ${primary}. ` +
        `Transcribe those spans in ${guest} exactly as spoken; do not transliterate them.`,
    );
  }
  const terms = input.keywords.map(cleanKeyword).filter(Boolean).slice(0, MAX_KEYWORDS);
  if (terms.length) lines.push(`Expected terms: ${terms.join(", ")}.`);
  return lines.length ? lines.join(" ") : undefined;
}

/**
 * The GA client-secret request body for one transcription session.
 *
 * Split out so a test can assert the exact shape without a network call, which
 * is the only way this contract can be checked from a repository that holds no
 * OpenAI credentials.
 */
export function openAiClientSecretBody(transcription: OpenAiTranscriptionConfig) {
  return {
    session: {
      type: "transcription" as const,
      audio: {
        input: {
          // GA states the PCM format as an object. 24 kHz is the only rate the
          // realtime API supports, and it is what the capture path produces.
          format: { type: "audio/pcm" as const, rate: 24000 as const },
          transcription,
        },
      },
    },
  };
}
