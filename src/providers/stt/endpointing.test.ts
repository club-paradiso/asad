import { describe, expect, it } from "vitest";
import { DeepgramSpeechProvider } from "./deepgram";
import { OpenAiSpeechProvider } from "./openai";
import type { SttProviderOptions } from "./types";

class InspectableDeepgram extends DeepgramSpeechProvider {
  async url(): Promise<URL> {
    const { url } = await this.socketUrl();
    return new URL(url);
  }
  message(data: unknown) {
    this.handleMessage(data);
  }
}

class InspectableOpenAi extends OpenAiSpeechProvider {
  session(): Record<string, unknown> {
    return JSON.parse(this.openMessage() ?? "{}").session;
  }
}

const credentials = { provider: "deepgram" as const, token: "temporary" };
const deepgram = (options: SttProviderOptions) =>
  new InspectableDeepgram({ credentials, ...options });

describe("Deepgram endpointing", () => {
  it("waits longer for silence in a single counter turn than in a live service", async () => {
    // "uh… extension… my visa… May thirty one" is an ordinary counter turn.
    // At 300 ms every hesitation closed a segment, so one sentence arrived as
    // four fragments and smart formatting never saw the date whole.
    const counter = await deepgram({ language: "ko-KR", utterance: true }).url();
    const live = await deepgram({ language: "ko-KR" }).url();

    expect(Number(counter.searchParams.get("endpointing"))).toBeGreaterThan(
      Number(live.searchParams.get("endpointing")),
    );
    expect(live.searchParams.get("endpointing")).toBe("300");
  });

  it("asks for an explicit end-of-utterance signal in counter turns only", async () => {
    const counter = await deepgram({ language: "ko-KR", utterance: true }).url();
    expect(counter.searchParams.get("utterance_end_ms")).toBeTruthy();
    expect(counter.searchParams.get("vad_events")).toBe("true");
    // UtteranceEnd requires interim results to be on.
    expect(counter.searchParams.get("interim_results")).toBe("true");

    const live = await deepgram({ language: "ko-KR" }).url();
    expect(live.searchParams.get("utterance_end_ms")).toBeNull();
  });

  it("treats that signal as the end of the turn", async () => {
    const provider = deepgram({ language: "ko-KR", utterance: true });
    const statuses: string[] = [];
    provider.onStatus((status) => statuses.push(status));
    provider.message({ type: "UtteranceEnd" });
    expect(statuses).toContain("closed");
  });

  it("ignores that signal in a continuous live session", async () => {
    const provider = deepgram({ language: "ko-KR" });
    const statuses: string[] = [];
    provider.onStatus((status) => statuses.push(status));
    provider.message({ type: "UtteranceEnd" });
    expect(statuses).toEqual([]);
  });

  it("still carries the audio format the capture actually produces", async () => {
    const url = await deepgram({ language: "ko-KR", utterance: true }).url();
    expect(url.searchParams.get("encoding")).toBe("linear16");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
    expect(url.searchParams.get("channels")).toBe("1");
  });

  it("passes vocabulary hints through as keyterms", async () => {
    const url = await deepgram({
      language: "ko-KR",
      utterance: true,
      hints: ["체류자격", "E-7"],
    }).url();
    expect(url.searchParams.getAll("keyterm")).toEqual(["체류자격", "E-7"]);
  });

  it("refuses a language it has no model for rather than guessing one", async () => {
    await expect(deepgram({ language: "ug-CN", utterance: true }).url()).rejects.toThrow(
      /does not support/i,
    );
  });
});

describe("OpenAI realtime turn detection", () => {
  const openai = (options: SttProviderOptions) =>
    new InspectableOpenAi({
      credentials: { provider: "openai", token: "ephemeral" },
      ...options,
    });

  it("allows a longer pause in a counter turn", () => {
    const counter = openai({ language: "en-US", utterance: true }).session();
    const live = openai({ language: "en-US" }).session();
    const detection = (session: Record<string, unknown>) =>
      session.turn_detection as { silence_duration_ms: number; prefix_padding_ms: number };

    expect(detection(counter).silence_duration_ms).toBeGreaterThan(
      detection(live).silence_duration_ms,
    );
  });

  it("keeps the audio from just before speech was detected", () => {
    // Otherwise the first syllable is spent triggering the detector and then
    // thrown away, which is the first-word loss this product cares about most.
    const session = openai({ language: "en-US", utterance: true }).session();
    const detection = session.turn_detection as { prefix_padding_ms: number };
    expect(detection.prefix_padding_ms).toBeGreaterThan(0);
  });

  it("passes vocabulary hints through as a transcription prompt", () => {
    const session = openai({
      language: "en-US",
      utterance: true,
      hints: ["alien registration", "E-7"],
    }).session();
    const transcription = session.input_audio_transcription as { prompt?: string };
    expect(transcription.prompt).toContain("alien registration");
    expect(transcription.prompt).toContain("E-7");
  });
});
