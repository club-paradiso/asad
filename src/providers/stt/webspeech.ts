/**
 * Browser-native speech recognition.
 *
 * No key, no server, no audio leaves the browser API boundary. This is the
 * zero-configuration live path and the graceful fallback when a cloud provider
 * is unreachable.
 *
 * Known limits, documented rather than hidden: Chrome and Edge implement it
 * well, Safari's support is partial and iOS Safari will not run it in the
 * background. `isSupported()` gates the UI so the interpreter is told this up
 * front rather than discovering it mid-service.
 */
import { BaseSpeechProvider, type SttProviderId, type SttProviderOptions } from "./types";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getConstructor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class WebSpeechProvider extends BaseSpeechProvider {
  readonly id: SttProviderId = "webspeech";
  readonly needsAudio = false;

  private recognition: SpeechRecognitionLike | null = null;
  private wantRunning = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: SttProviderOptions = {}) {
    super();
  }

  static isSupported(): boolean {
    return getConstructor() !== null;
  }

  async connect(): Promise<void> {
    const Ctor = getConstructor();
    if (!Ctor) throw new Error("This browser has no built-in speech recognition.");

    this.wantRunning = true;
    this.emitStatus("connecting");

    const recognition = new Ctor();
    recognition.lang = this.options.language ?? "ko-KR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => this.emitStatus("listening");

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) this.emitStable(text);
        else interim += text;
      }
      if (interim) this.emitPartial(interim);
    };

    recognition.onerror = (event) => {
      const code = event.error ?? "unknown";
      // `no-speech` and `aborted` are routine during a service; do not surface
      // them as failures or the interpreter learns to ignore the status light.
      if (code === "no-speech" || code === "aborted") return;
      this.emitError(new Error(`Speech recognition error: ${code}`));
      this.emitStatus(code === "not-allowed" ? "error" : "reconnecting", code);
    };

    // Browsers stop recognition on silence; restart it for a long session.
    recognition.onend = () => {
      if (!this.wantRunning) {
        this.emitStatus("closed");
        return;
      }
      this.emitStatus("reconnecting");
      this.restartTimer = setTimeout(() => {
        try {
          recognition.start();
        } catch {
          // Already starting — harmless.
        }
      }, 250);
    };

    this.recognition = recognition;
    recognition.start();
  }

  sendAudio(): void {
    // The browser owns the microphone for this provider.
  }

  async disconnect(): Promise<void> {
    this.wantRunning = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    try {
      this.recognition?.stop();
    } catch {
      this.recognition?.abort();
    }
    this.recognition = null;
    this.emitStatus("closed");
  }
}
