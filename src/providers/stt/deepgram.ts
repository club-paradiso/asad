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
import { deepgramLanguage } from "./language";
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

    const language = deepgramLanguage(this.options.language);
    if (!language) {
      throw new Error(
        `Deepgram does not support the requested Counter language: ${this.options.language ?? "unknown"}`,
      );
    }

    const params = new URLSearchParams({
      model: credentials.model ?? "nova-3",
      language,
      interim_results: "true",
      punctuate: "true",
      smart_format: "true",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      // Endpointing is the silence, in milliseconds, after which Deepgram calls
      // a segment final.
      //
      // A live service is continuous speech, and 300 ms keeps the socket
      // responsive through its quiet parts. One turn at a counter is nothing
      // like that. "uh… extension… my visa… May thirty one" is normal there,
      // and at 300 ms every one of those pauses closes a segment, so a single
      // sentence arrives as four fragments and smart-formatting never sees the
      // whole thing — which is exactly where dates and status codes get
      // mangled. The visitor can always end the turn instantly by tapping
      // stop, so waiting longer for silence costs them nothing.
      endpointing: this.options.utterance ? "1000" : "300",
      ...(this.options.utterance
        ? {
            // An explicit "they have stopped talking" signal, computed from
            // word timings rather than guessed from a client-side timer.
            utterance_end_ms: "1800",
            vad_events: "true",
          }
        : {}),
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

    // Deepgram's own end-of-utterance verdict, which it derives from the gap
    // between word timings. In one-utterance mode that is a better answer than
    // any silence timer this side of the socket could compute, so surface it
    // as a close and let the controller finalise with what it already has.
    if (message?.type === "UtteranceEnd") {
      if (this.options.utterance) this.emitStatus("closed", "utterance-end");
      return;
    }

    const transcript = message?.channel?.alternatives?.[0]?.transcript?.trim();
    if (!transcript) return;

    if (message.is_final) this.emitStable(transcript);
    else this.emitPartial(transcript);
  }

  protected closeMessage(): string {
    return JSON.stringify({ type: "CloseStream" });
  }
}
