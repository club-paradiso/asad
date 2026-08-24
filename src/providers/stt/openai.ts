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
    return JSON.stringify({
      type: "transcription_session.update",
      session: {
        input_audio_format: "pcm16",
        input_audio_transcription: {
          model: this.options.credentials?.model ?? "gpt-live-transcribe",
          language: this.options.language?.split("-")[0] ?? "ko",
          prompt: (this.options.hints ?? []).slice(0, 40).join(", ") || undefined,
        },
        turn_detection: { type: "server_vad", silence_duration_ms: 400 },
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
