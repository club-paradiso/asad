/**
 * The provider contract, pair by pair.
 *
 * A live session is always TWO languages, and every layer that talks to a
 * vendor has to answer the same four questions about that pair: what do I call
 * the language, may I declare the second one, what request shape does this
 * exact model take, and what does the user lose by going this way.
 *
 * Those answers used to be scattered — a tag map here, a prose prompt there, a
 * `model.includes("live")` guess in between — and the failure mode was silent:
 * a session would run, produce fluent output, and quietly not be the thing the
 * speaker said. This file states the answer for every pair the product names as
 * first-class, so a regression is a diff rather than a stage incident.
 *
 * Every expectation below is read off the language registry, which is the one
 * place a vendor's coverage is declared. Nothing here infers a capability from
 * a tag's shape.
 */
import { describe, expect, it } from "vitest";
import {
  buildOpenAiTranscriptionConfig,
  openAiClientSecretBody,
  openAiTranscriptionCapabilities,
} from "./openai-transcription";
import { OpenAiSpeechProvider } from "./openai";
import { deepgramSessionLanguage, sttCodeSwitchSupport, whisperLanguage, webSpeechLanguage } from "./language";
import { sttLanguageSupport, counterSpeechPlan } from "./capability";
import { pairIsScriptDecidable } from "@/lib/code-switch";
import type { CodeSwitchSupport, SttFidelity } from "@/lib/languages";

/** The two models the deployment actually reaches, one per documented family. */
const MODERN = "gpt-live-transcribe";
const LEGACY = "whisper-1";

interface PairContract {
  source: string;
  target: string;
  /** The `language` query parameter a Deepgram socket carries for this pair. */
  deepgram: string | null;
  /** Whether Deepgram's multilingual model genuinely covers BOTH sides. */
  deepgramSwitching: CodeSwitchSupport;
  /** `languages` on the gpt-transcribe family: the real multilingual hint. */
  openAiLanguages: string[];
  /** `language` on the whisper family: one code, and only the speaker's. */
  whisper: string;
  /** What the browser recogniser is told, when it is offered at all. */
  webSpeech: string;
  /** Whether character evidence can tell the two sides of this pair apart. */
  decidable: boolean;
  /** What the guest language loses on the way through the Whisper family. */
  guestFidelity: SttFidelity;
}

/**
 * The sixteen pairs the product commits to.
 *
 * Eleven of them are Korean paired with each first-class target, because that
 * is the deployment; the last five are the inverse direction, which is where
 * assumptions written for "Korean plus Latin" break.
 */
const PAIRS: PairContract[] = [
  // Korean is NOT in Deepgram's multilingual model, so every Korean pair stays
  // on the monolingual Korean stream and leans on keyterm prompting instead.
  { source: "ko-KR", target: "en-US", deepgram: "ko-KR", deepgramSwitching: "none",
    openAiLanguages: ["ko", "en"], whisper: "ko", webSpeech: "ko-KR",
    decidable: true, guestFidelity: "native" },
  { source: "ko-KR", target: "zh-CN", deepgram: "ko-KR", deepgramSwitching: "none",
    openAiLanguages: ["ko", "zh"], whisper: "ko", webSpeech: "ko-KR",
    decidable: true, guestFidelity: "native" },
  // Same two codes as Simplified — because Whisper HAS no third code. The loss
  // is recorded as fidelity rather than pretended away in the request.
  { source: "ko-KR", target: "zh-TW", deepgram: "ko-KR", deepgramSwitching: "none",
    openAiLanguages: ["ko", "zh"], whisper: "ko", webSpeech: "ko-KR",
    decidable: true, guestFidelity: "variant-lossy" },
  { source: "ko-KR", target: "ja-JP", deepgram: "ko-KR", deepgramSwitching: "none",
    openAiLanguages: ["ko", "ja"], whisper: "ko", webSpeech: "ko-KR",
    decidable: true, guestFidelity: "native" },
  { source: "ko-KR", target: "ru-RU", deepgram: "ko-KR", deepgramSwitching: "none",
    openAiLanguages: ["ko", "ru"], whisper: "ko", webSpeech: "ko-KR",
    decidable: true, guestFidelity: "native" },
  { source: "ko-KR", target: "mn-MN", deepgram: "ko-KR", deepgramSwitching: "none",
    openAiLanguages: ["ko", "mn"], whisper: "ko", webSpeech: "ko-KR",
    decidable: true, guestFidelity: "experimental" },
  { source: "ko-KR", target: "ar-SA", deepgram: "ko-KR", deepgramSwitching: "none",
    openAiLanguages: ["ko", "ar"], whisper: "ko", webSpeech: "ko-KR",
    decidable: true, guestFidelity: "native" },
  { source: "ko-KR", target: "hi-IN", deepgram: "ko-KR", deepgramSwitching: "none",
    openAiLanguages: ["ko", "hi"], whisper: "ko", webSpeech: "ko-KR",
    decidable: true, guestFidelity: "native" },
  { source: "ko-KR", target: "th-TH", deepgram: "ko-KR", deepgramSwitching: "none",
    openAiLanguages: ["ko", "th"], whisper: "ko", webSpeech: "ko-KR",
    decidable: true, guestFidelity: "native" },
  { source: "ko-KR", target: "vi-VN", deepgram: "ko-KR", deepgramSwitching: "none",
    openAiLanguages: ["ko", "vi"], whisper: "ko", webSpeech: "ko-KR",
    decidable: true, guestFidelity: "native" },
  { source: "ko-KR", target: "id-ID", deepgram: "ko-KR", deepgramSwitching: "none",
    openAiLanguages: ["ko", "id"], whisper: "ko", webSpeech: "ko-KR",
    decidable: true, guestFidelity: "native" },

  // The inverse direction. Japanese and Russian are both in Deepgram's
  // multilingual set alongside English, so these two pairs — and only these two
  // — genuinely earn `language=multi`.
  { source: "ja-JP", target: "en-US", deepgram: "multi", deepgramSwitching: "multi-model",
    openAiLanguages: ["ja", "en"], whisper: "ja", webSpeech: "ja-JP",
    decidable: true, guestFidelity: "native" },
  { source: "ru-RU", target: "en-US", deepgram: "multi", deepgramSwitching: "multi-model",
    openAiLanguages: ["ru", "en"], whisper: "ru", webSpeech: "ru-RU",
    decidable: true, guestFidelity: "native" },
  // Mongolian is Cyrillic like Russian and is NOT in the multilingual set.
  // Reading "Cyrillic" as "Russian" here would have bought a socket refusal.
  { source: "mn-MN", target: "en-US", deepgram: "mn", deepgramSwitching: "none",
    openAiLanguages: ["mn", "en"], whisper: "mn", webSpeech: "mn-MN",
    decidable: true, guestFidelity: "native" },
  // Vietnamese and Indonesian are written in the SAME script as English, so
  // character evidence cannot separate these pairs and the analyser says so.
  { source: "vi-VN", target: "en-US", deepgram: "vi", deepgramSwitching: "none",
    openAiLanguages: ["vi", "en"], whisper: "vi", webSpeech: "vi-VN",
    decidable: false, guestFidelity: "native" },
  { source: "id-ID", target: "en-US", deepgram: "id", deepgramSwitching: "none",
    openAiLanguages: ["id", "en"], whisper: "id", webSpeech: "id-ID",
    decidable: false, guestFidelity: "native" },
];

describe.each(PAIRS)("$source → $target", (pair) => {
  it("declares the Deepgram stream language the registry documents", () => {
    expect(deepgramSessionLanguage(pair.source, pair.target)).toBe(pair.deepgram);
    expect(sttCodeSwitchSupport("deepgram", pair.source, pair.target)).toBe(pair.deepgramSwitching);
  });

  it("asks a gpt-transcribe model for both languages and never the singular one", () => {
    const config = buildOpenAiTranscriptionConfig({
      model: MODERN,
      primaryLanguage: pair.source,
      guestLanguage: pair.target,
      keywords: ["RAG"],
    });
    expect(config.languages).toEqual(pair.openAiLanguages);
    // OpenAI's migration guidance is explicit that `language` and `languages`
    // must not both be sent, and sending the singular one is what made the
    // multilingual hint unreachable in the first place.
    expect(config.language).toBeUndefined();
  });

  it("asks a whisper model only for the speaker's language", () => {
    const config = buildOpenAiTranscriptionConfig({
      model: LEGACY,
      primaryLanguage: pair.source,
      guestLanguage: pair.target,
      keywords: ["RAG"],
    });
    expect(config.language).toBe(pair.whisper);
    expect(config.languages).toBeUndefined();
    // No `keywords` field on this family. Sending one would be a parameter the
    // model does not document, so the terminology rides the prompt instead.
    expect(config.keywords).toBeUndefined();
    expect(config.prompt).toContain("RAG");
  });

  it("names the browser locale and the script the cloud path costs", () => {
    expect(webSpeechLanguage(pair.source)).toBe(pair.webSpeech);
    expect(whisperLanguage(pair.target)?.fidelity).toBe(pair.guestFidelity);
  });

  it("says honestly whether the two scripts can be told apart", () => {
    expect(pairIsScriptDecidable(pair.source, pair.target)).toBe(pair.decidable);
  });
});

describe("what the guest hint is allowed to claim", () => {
  it("states the mixture in prose only for what the structured fields cannot say", () => {
    const config = buildOpenAiTranscriptionConfig({
      model: MODERN,
      primaryLanguage: "ko-KR",
      guestLanguage: "ar-SA",
      keywords: ["Putnam"],
    });
    // `languages` already says which languages; `keywords` already carries the
    // vocabulary. The prompt is left with the one instruction neither encodes.
    expect(config.prompt).toContain("Arabic");
    expect(config.prompt).toContain("do not transliterate");
    expect(config.prompt).not.toContain("Putnam");
  });

  it("says nothing about a guest that is the same language", () => {
    const config = buildOpenAiTranscriptionConfig({
      model: MODERN,
      primaryLanguage: "zh-CN",
      guestLanguage: "zh-TW",
      keywords: [],
    });
    // Simplified → Traditional is transliteration, not a code switch, and both
    // tags resolve to `zh`. Declaring it twice would be noise.
    expect(config.languages).toEqual(["zh"]);
    expect(config.prompt).toBeUndefined();
  });

  it("refuses to name a guest language the vendor cannot transcribe", () => {
    // The registry records Whisper coverage for Uyghur as null on purpose: the
    // model is not trained on it, and asking for `ug` yields fluent text in a
    // neighbouring language. Deriving `ug` from the tag would have sent a
    // parameter the vendor cannot honour and called that support.
    const config = buildOpenAiTranscriptionConfig({
      model: MODERN,
      primaryLanguage: "ko-KR",
      guestLanguage: "ug-CN",
    });
    expect(config.languages).toEqual(["ko"]);
    expect(config.prompt).toBeUndefined();
  });
});

describe("keywords reaching the recogniser intact", () => {
  it("carries a term in its own script, byte for byte", () => {
    const terms = ["사회적 자본", "رأس المال", "सामाजिक पूंजी", "ทุนทางสังคม", "нийгмийн капитал"];
    const config = buildOpenAiTranscriptionConfig({
      model: MODERN,
      primaryLanguage: "ko-KR",
      guestLanguage: "en-US",
      keywords: terms,
    });
    expect(config.keywords).toEqual(terms);
  });

  it("strips only what the vendor documents as illegal in a keyword", () => {
    const config = buildOpenAiTranscriptionConfig({
      model: MODERN,
      primaryLanguage: "ko-KR",
      guestLanguage: "en-US",
      keywords: ["social <capital>", "line\none", "  Putnam  "],
    });
    expect(config.keywords).toEqual(["social capital", "line one", "Putnam"]);
  });

  it("never cuts a keyword through the middle of a written syllable", () => {
    // की is ONE syllable written as two code points: the consonant क and the
    // vowel sign ी that belongs to it. The leading x below puts the sixty-
    // character limit between them — cutting there would keep क alone, which
    // is not an abbreviation of की but a different syllable, and a recogniser
    // biased towards it would listen for something nobody said.
    const long = `x${"की".repeat(60)}`;
    const [kept] = buildOpenAiTranscriptionConfig({
      model: MODERN,
      primaryLanguage: "hi-IN",
      guestLanguage: "en-US",
      keywords: [long],
    }).keywords!;
    expect(long.startsWith(kept)).toBe(true);
    // One short of the limit, because the whole syllable was dropped rather
    // than half of it kept.
    expect(kept.length).toBe(59);
    expect(kept.endsWith("की")).toBe(true);
  });
});

describe("combinations the stack refuses rather than attempts", () => {
  it("reports no Deepgram stream for a language Deepgram does not serve", () => {
    for (const language of ["uz-UZ", "km-KH", "my-MM"]) {
      expect(deepgramSessionLanguage(language, "en-US")).toBeNull();
      expect(sttLanguageSupport("deepgram", language)).toBe("unsupported");
    }
  });

  it("offers no recogniser at all for a language nothing covers", () => {
    // Uyghur is offered as a live TARGET, which needs no recogniser. It is not
    // offered as a source, and the capability layer agrees rather than opening
    // a socket to find out.
    expect(counterSpeechPlan("ug-CN")).toEqual([]);
  });

  it("keeps the browser recogniser out of languages it does not list", () => {
    // Mongolian passes through as its own tag — but the capability layer never
    // selects the browser for it, so that pass-through is never sent.
    expect(webSpeechLanguage("mn-MN")).toBe("mn-MN");
    expect(sttLanguageSupport("webspeech", "mn-MN")).toBe("unsupported");
  });

  it("never asks for the multilingual model without a real second language", () => {
    expect(deepgramSessionLanguage("ja-JP")).toBe("ja");
    expect(deepgramSessionLanguage("ja-JP", "ja-JP")).toBe("ja");
  });
});

describe("falling back when the configured model is not one we know", () => {
  it("treats an unrecognised model as the older, more widely accepted contract", () => {
    // A deployer's override or a model released after this was written. The
    // whisper shape is the safer guess: every transcription model has taken
    // `language` + `prompt`, and only some take `languages` + `keywords`.
    expect(openAiTranscriptionCapabilities("some-future-model").family).toBe("whisper");
    const config = buildOpenAiTranscriptionConfig({
      model: "some-future-model",
      primaryLanguage: "ko-KR",
      guestLanguage: "en-US",
      keywords: ["RAG"],
    });
    expect(config.language).toBe("ko");
    expect(config.languages).toBeUndefined();
    expect(config.keywords).toBeUndefined();
  });

  it("resolves a dated snapshot to its model's contract", () => {
    expect(openAiTranscriptionCapabilities("gpt-transcribe-2026-07-28").family).toBe(
      "gpt-transcribe",
    );
  });

  it("degrades to the browser when the cloud path would lose the script", () => {
    // Traditional Chinese through Whisper returns Simplified characters, so the
    // plan puts any faithful path ahead of it rather than preferring cloud by
    // reflex.
    const plan = counterSpeechPlan("zh-TW");
    expect(plan[0]).toEqual({ provider: "deepgram", support: "native" });
    expect(plan.at(-1)).toEqual({ provider: "openai", support: "variant-lossy" });
  });
});

/* --------------------------------------------------------------------------
 * The interface the request is actually made against
 * ------------------------------------------------------------------------ */

describe("the OpenAI realtime interface this talks to", () => {
  /**
   * Verified against OpenAI's own published types (`openai` on npm, 7.18.0):
   *
   *   resources/realtime/realtime.d.ts        GA   `languages`, `keywords`,
   *                                                `gpt-live-transcribe`
   *   resources/beta/realtime/realtime.d.ts   beta `language`, `model`,
   *                                                `prompt` — and nothing else
   *
   * The beta interface has no field that can express "this audio contains two
   * languages", and does not list this deployment's model. Every assertion
   * below exists so the socket cannot quietly drift back onto it.
   */
  const open = (provider: OpenAiSpeechProvider) =>
    (provider as unknown as { socketUrl(): Promise<{ url: string; protocols: string[] }> })
      .socketUrl();

  it("negotiates the GA subprotocols and not the beta opt-in", async () => {
    const { url, protocols } = await open(
      new OpenAiSpeechProvider({
        language: "ko-KR",
        guestLanguage: "en-US",
        credentials: { provider: "openai", token: "ek_test", model: MODERN },
      }),
    );
    expect(url).toBe("wss://api.openai.com/v1/realtime?intent=transcription");
    expect(protocols).toEqual(["realtime", "openai-insecure-api-key.ek_test"]);
    expect(protocols).not.toContain("openai-beta.realtime-v1");
  });

  it("mints the client secret against the GA endpoint's body shape", () => {
    const transcription = buildOpenAiTranscriptionConfig({
      model: MODERN,
      primaryLanguage: "ko-KR",
      guestLanguage: "en-US",
      keywords: ["RAG"],
    });
    expect(openAiClientSecretBody(transcription)).toEqual({
      session: {
        type: "transcription",
        audio: {
          input: {
            // GA states the format as an object; the beta endpoint took the
            // string "pcm16" at the top level of the body.
            format: { type: "audio/pcm", rate: 24000 },
            transcription: {
              model: MODERN,
              languages: ["ko", "en"],
              keywords: ["RAG"],
              prompt: expect.stringContaining("do not transliterate"),
            },
          },
        },
      },
    });
  });

  it("sends the opening update with the flat field names GA specifies for it", () => {
    const message = JSON.parse(
      (
        new OpenAiSpeechProvider({
          language: "ko-KR",
          guestLanguage: "en-US",
          credentials: { provider: "openai", token: "t", model: MODERN },
        }) as unknown as { openMessage(): string }
      ).openMessage(),
    ) as { type: string; session: Record<string, unknown> };
    // The create request nests under `audio.input`; the update event does not.
    // Both shapes are GA — they are simply different objects.
    expect(message.type).toBe("transcription_session.update");
    expect(Object.keys(message.session).sort()).toEqual([
      "input_audio_format",
      "input_audio_transcription",
      "turn_detection",
    ]);
  });

  it("omits turn detection for the model that documents no VAD", () => {
    // `gpt-realtime-whisper` transcription sessions require turn detection to
    // be null, and do not accept a prompt. Both are left out rather than sent
    // and hopefully ignored.
    const caps = openAiTranscriptionCapabilities("gpt-realtime-whisper");
    expect(caps).toMatchObject({ prompt: false, turnDetection: false, keywords: false });

    const message = JSON.parse(
      (
        new OpenAiSpeechProvider({
          language: "ko-KR",
          guestLanguage: "en-US",
          hints: ["RAG"],
          credentials: { provider: "openai", token: "t", model: "gpt-realtime-whisper" },
        }) as unknown as { openMessage(): string }
      ).openMessage(),
    ) as { session: { turn_detection?: unknown; input_audio_transcription: OpenAiConfig } };
    expect(message.session.turn_detection).toBeUndefined();
    expect(message.session.input_audio_transcription.prompt).toBeUndefined();
    expect(message.session.input_audio_transcription.keywords).toBeUndefined();
    expect(message.session.input_audio_transcription.language).toBe("ko");
  });
});

type OpenAiConfig = {
  language?: string;
  languages?: string[];
  keywords?: string[];
  prompt?: string;
};
