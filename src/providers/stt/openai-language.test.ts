import { describe, expect, it } from "vitest";
import { OpenAiSpeechProvider, openaiTranscriptionPrompt } from "./openai";
import type { SttProviderOptions } from "./types";

class InspectableOpenAi extends OpenAiSpeechProvider {
  transcription(): { model: string; language?: string; prompt?: string } {
    return JSON.parse(this.openMessage() ?? "{}").session.input_audio_transcription;
  }
}

const openai = (options: SttProviderOptions) =>
  new InspectableOpenAi({
    credentials: { provider: "openai", token: "ephemeral" },
    ...options,
  });

describe("OpenAI realtime language selection", () => {
  it("sends the registry's Whisper code, not the raw tag's first subtag", () => {
    expect(openai({ language: "zh-TW" }).transcription().language).toBe("zh");
    expect(openai({ language: "zh-Hant-HK" }).transcription().language).toBe("zh");
    expect(openai({ language: "tl-PH" }).transcription().language).toBe("tl");
    expect(openai({ language: "fil-PH" }).transcription().language).toBe("tl");
    expect(openai({}).transcription().language).toBe("ko");
  });

  it("biases a zh-TW session toward Traditional characters through the prompt", () => {
    // Whisper takes `zh` for both scripts, so the code alone lets the model
    // pick; the registry's Traditional-script sentence is what steers it.
    const transcription = openai({ language: "zh-TW", utterance: true }).transcription();
    expect(transcription.language).toBe("zh");
    expect(transcription.prompt).toBe("以下是國語的繁體中文轉寫。");
  });

  it("biases a zh-CN session toward Simplified characters", () => {
    const transcription = openai({ language: "zh-CN", utterance: true }).transcription();
    expect(transcription.prompt).toBe("以下是普通话的简体中文转写。");
  });

  it("puts the script prompt before the vocabulary hints", () => {
    const transcription = openai({
      language: "zh-TW",
      hints: ["居留證", "E-7"],
    }).transcription();
    expect(transcription.prompt).toBe("以下是國語的繁體中文轉寫。 居留證, E-7");
    expect(openaiTranscriptionPrompt("zh-TW", ["居留證"])?.startsWith("以下是國語的繁體中文轉寫。")).toBe(true);
  });

  it("sends no prompt at all for a language without a script bias and without hints", () => {
    expect(openai({ language: "ko-KR" }).transcription().prompt).toBeUndefined();
    expect(openai({ language: "en-US", hints: ["  "] }).transcription().prompt).toBeUndefined();
    expect(openaiTranscriptionPrompt("en-US", ["alien registration"])).toBe("alien registration");
  });

  it("omits the language rather than forcing a neighbour for one Whisper cannot take", () => {
    // The capability matrix keeps Uyghur away from this provider; should a
    // caller bypass it, the registry's null must not become `ug` or `ar`.
    expect(openai({ language: "ug-CN" }).transcription().language).toBeUndefined();
  });
});
