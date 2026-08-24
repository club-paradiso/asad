/**
 * Deepgram streaming recogniser.
 *
 * Chosen as the default cloud provider — see docs/architecture.md for the
 * comparison. What matters here: true interim results (`is_final: false`),
 * `keyterm` support for feeding the prep sheet's terminology in, and a
 * long-lived socket that survives a 70-minute service.
 *
 * The account key never reaches the browser: `/api/stt/token` mints a
 * short-lived key server-side and this provider receives only that.
 */
import { SocketSpeechProvider } from "./socket";
import type { SttProviderId, SttProviderOptions } from "./types";

interface DeepgramAlternative {
  transcript?: string;
}
interface DeepgramMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: DeepgramAlternative[] };
}

export class DeepgramSpeechProvider extends SocketSpeechProvider {
  readonly id: SttProviderId = "deepgram";

  constructor(private readonly options: SttProviderOptions = {}) {
    super();
  }

  protected async socketUrl() {
    const credentials = this.options.credentials;
    if (!credentials?.token) {
      throw new Error("No Deepgram token — check STT configuration on the server.");
    }

    const params = new URLSearchParams({
      model: credentials.model ?? "nova-3",
      language: this.options.language?.split("-")[0] ?? "ko",
      interim_results: "true",
      punctuate: "true",
      smart_format: "true",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      // Keeps the socket alive through the quiet parts of a service.
      endpointing: "300",
    });

    // Terminology hints from the prep sheet materially help proper nouns.
    for (const hint of (this.options.hints ?? []).slice(0, 50)) {
      if (hint.trim()) params.append("keyterm", hint.trim());
    }

    const base = credentials.url ?? "wss://api.deepgram.com/v1/listen";
    return {
      url: `${base}?${params.toString()}`,
      // Deepgram accepts the key through the WebSocket subprotocol, which is
      // the only header-like channel a browser WebSocket gives us.
      protocols: ["token", credentials.token],
    };
  }

  protected handleMessage(data: unknown): void {
    const message = data as DeepgramMessage;
    if (message?.type === "Metadata" || message?.type === "SpeechStarted") return;

    const transcript = message?.channel?.alternatives?.[0]?.transcript?.trim();
    if (!transcript) return;

    if (message.is_final) this.emitStable(transcript);
    else this.emitPartial(transcript);
  }

  protected closeMessage(): string {
    return JSON.stringify({ type: "CloseStream" });
  }
}
