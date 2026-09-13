/**
 * OpenAI realtime transcription.
 *
 * Uses the realtime transcription socket with a streaming-oriented model, so
 * deltas arrive as the speaker talks rather than at the end of a turn. Audio
 * frames are sent as base64 PCM16 append events.
 *
 * As with Deepgram, the browser only ever holds an ephemeral session token
 * minted by `/api/stt/token`.
 */
import { SocketSpeechProvider } from "./socket";
import { openaiTranscriptionLanguage, whisperScriptPrompt } from "./language";
import type { SttProviderId, SttProviderOptions } from "./types";

interface OpenAiRealtimeMessage {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
}

const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

/**
 * The transcription prompt Whisper sees: the registry's script-biasing
 * sentence first (so zh-TW is transcribed in Traditional characters and zh-CN
 * in Simplified), then the vocabulary hints. Undefined when there is nothing
 * to say.
 */
export function openaiTranscriptionPrompt(
  language: string | undefined,
  hints: readonly string[] | undefined,
): string | undefined {
  const script = whisperScriptPrompt(language);
  const vocabulary = (hints ?? []).slice(0, 40).map((hint) => hint.trim()).filter(Boolean);
  const parts = [script, vocabulary.length ? vocabulary.join(", ") : undefined].filter(
    (part): part is string => !!part,
  );
  return parts.length ? parts.join(" ") : undefined;
}

export class OpenAiSpeechProvider extends SocketSpeechProvider {
  readonly id: SttProviderId = "openai";

  /** Accumulates deltas so partials show the whole in-progress utterance. */
  private buffer = "";

  constructor(private readonly options: SttProviderOptions = {}) {
    super();
  }

  protected async socketUrl() {
    const credentials = this.options.credentials;
    if (!credentials?.token) {
      throw new Error("No OpenAI realtime token — check STT configuration on the server.");
    }
    const base = credentials.url ?? "wss://api.openai.com/v1/realtime?intent=transcription";
    return {
      url: base,
      protocols: ["realtime", `openai-insecure-api-key.${credentials.token}`, "openai-beta.realtime-v1"],
    };
  }

  protected openMessage(): string {
    // A language the Whisper family cannot transcribe never gets here: the
    // capability matrix removes this provider from the plan first. Should a
    // caller bypass it, the registry's null is still not turned into a guess —
    // the field is omitted and the model auto-detects, which is the lesser
    // evil compared with forcing a neighbouring language.
    const language = openaiTranscriptionLanguage(this.options.language) ?? undefined;
    return JSON.stringify({
      type: "transcription_session.update",
      session: {
        input_audio_format: "pcm16",
        input_audio_transcription: {
          model: this.options.credentials?.model ?? "gpt-live-transcribe",
          language,
          prompt: openaiTranscriptionPrompt(this.options.language, this.options.hints),
        },
        turn_detection: {
          type: "server_vad",
          // Counter speech hesitates. 400 ms of silence ends a turn while
          // someone is still working out how to say "체류자격 변경"; a second
          // is closer to how long a real pause at a desk actually lasts, and
          // tapping stop still ends the turn immediately.
          silence_duration_ms: this.options.utterance ? 900 : 400,
          // Include the audio just before speech was detected, so the first
          // syllable of a turn is transcribed rather than used to trigger the
          // detector and then discarded.
          prefix_padding_ms: 500,
        },
      },
    });
  }

  /** PCM16 frames are appended as base64 rather than sent as binary frames. */
  sendAudio(chunk: ArrayBuffer): void {
    const message = JSON.stringify({
      type: "input_audio_buffer.append",
      audio: toBase64(chunk),
    });
    // Reuse the base class's buffering/reconnect handling by sending text.
    super.sendAudio(new TextEncoder().encode(message).buffer as ArrayBuffer);
  }

  protected handleMessage(data: unknown): void {
    const message = data as OpenAiRealtimeMessage;
    switch (message?.type) {
      case "conversation.item.input_audio_transcription.delta": {
        if (!message.delta) return;
        this.buffer += message.delta;
        this.emitPartial(this.buffer);
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const text = (message.transcript ?? this.buffer).trim();
        this.buffer = "";
        if (text) this.emitStable(text);
        return;
      }
      case "error": {
        this.emitError(new Error(message.error?.message ?? "OpenAI realtime error"));
        return;
      }
      default:
        return;
    }
  }
}
