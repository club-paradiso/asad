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

const BENIGN_ERRORS = new Set(["no-speech", "aborted"]);
const FATAL_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "language-not-supported",
  "language-unavailable",
]);

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
    this.recognition = recognition;

    await new Promise<void>((resolve, reject) => {
      let connected = false;
      let settled = false;

      recognition.onstart = () => {
        connected = true;
        this.emitStatus("listening");
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      recognition.onresult = (event) => {
        // Web Speech may update only one result while older interim results are
        // still present. Rebuilding the visible partial from every non-final
        // result prevents words from disappearing between result events.
        let interim = "";
        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? "";
          if (result.isFinal) {
            // Final results before resultIndex were already emitted on an
            // earlier event; emitting them again duplicates the transcript.
            if (i >= event.resultIndex) this.emitStable(text);
          } else {
            interim += text;
          }
        }
        if (interim) this.emitPartial(interim);
      };

      recognition.onerror = (event) => {
        const code = event.error ?? "unknown";
        if (BENIGN_ERRORS.has(code)) return;

        const error = new Error(`Speech recognition error: ${code}`);
        const fatal = FATAL_ERRORS.has(code);

        // Permission and hardware errors do not heal by calling start() every
        // 250 ms. Stop the restart loop and give the UI a real retry action.
        if (fatal) this.wantRunning = false;

        this.emitError(error);
        this.emitStatus(fatal ? "error" : "reconnecting", code);

        // A connection that never reached onstart should fail its start()
        // promise. This keeps the session out of the dishonest "running"
        // phase and makes the retry button available immediately.
        if (!connected && !settled) {
          settled = true;
          this.wantRunning = false;
          reject(error);
        }
      };

      // Browsers stop recognition on silence; restart it for a long session.
      recognition.onend = () => {
        if (!this.wantRunning) {
          this.emitStatus("closed");
          return;
        }
        this.emitStatus("reconnecting");
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          if (!this.wantRunning) return;
          try {
            recognition.start();
          } catch {
            // Already starting — harmless. The pending start event remains the
            // authority on whether listening actually resumed.
          }
        }, 350);
      };

      try {
        recognition.start();
      } catch (error) {
        this.wantRunning = false;
        settled = true;
        reject(error);
      }
    });
  }

  sendAudio(): void {
    // The browser owns the microphone for this provider.
  }

  async disconnect(): Promise<void> {
    this.wantRunning = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const recognition = this.recognition;
    this.recognition = null;
    try {
      recognition?.stop();
    } catch {
      recognition?.abort();
    }
    this.emitStatus("closed");
  }
}
