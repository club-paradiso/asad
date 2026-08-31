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
import { webSpeechLanguage } from "./language";

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

/** Routine during any pause in speech. Not worth a word to the interpreter. */
const BENIGN_ERRORS = new Set(["no-speech", "aborted"]);

/**
 * Conditions that genuinely do not heal by trying again.
 *
 * Deliberately short. Everything here is a decision someone made — the visitor
 * denied the microphone, the deployment asked for a language this browser does
 * not have — and no amount of retrying changes it.
 */
const PERMANENT_ERRORS = new Set([
  "not-allowed",
  "language-not-supported",
  "language-unavailable",
]);

/**
 * Serious, but temporary.
 *
 * These used to be classified fatal, and that was the bug: ONE of them ended
 * the session outright, mid-sermon, with no retry. They are exactly the
 * failures that heal on their own — a Bluetooth headset taking the input
 * device, another app grabbing the microphone for a moment, the platform
 * speech service hiccupping. An interpreter working a room cannot have the
 * console give up the first time a headset switches.
 */
const RECOVERABLE_ERRORS = new Set([
  "service-not-allowed",
  "audio-capture",
  "network",
]);

const RECOVERY_ATTEMPTS = 4;
const RECOVERY_BACKOFF_MS = [400, 1200, 3000, 6000];

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
  private recoveryUsed = 0;

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
    this.recoveryUsed = 0;
    this.emitStatus("connecting");

    const recognition = new Ctor();
    recognition.lang = webSpeechLanguage(this.options.language);
    recognition.continuous = !this.options.utterance;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    this.recognition = recognition;

    await new Promise<void>((resolve, reject) => {
      let connected = false;
      let settled = false;

      recognition.onstart = () => {
        connected = true;
        this.recoveryUsed = 0;
        this.emitStatus("listening");
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      recognition.onresult = (event) => {
        let interim = "";
        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? "";
          if (result.isFinal) {
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

        const recoverable = RECOVERABLE_ERRORS.has(code);
        const budgetLeft = recoverable && this.recoveryUsed < RECOVERY_ATTEMPTS;
        const fatal = PERMANENT_ERRORS.has(code) || (recoverable && !budgetLeft);

        const error = new Error(
          fatal && recoverable
            ? `Speech recognition stopped after ${RECOVERY_ATTEMPTS} attempts to recover: ${code}`
            : `Speech recognition error: ${code}`,
        );

        if (fatal) this.wantRunning = false;

        if (!fatal) this.recoveryUsed += 1;
        else this.emitError(error);

        this.emitStatus(fatal ? "error" : "reconnecting", code);

        if (!fatal && recoverable) {
          this.scheduleRestart(recognition, RECOVERY_BACKOFF_MS[this.recoveryUsed - 1] ?? 6000);
        }

        if (fatal && !connected && !settled) {
          settled = true;
          this.wantRunning = false;
          reject(error);
        }
      };

      recognition.onend = () => {
        if (!this.wantRunning) {
          this.emitStatus("closed");
          return;
        }

        if (this.options.utterance) {
          this.wantRunning = false;
          this.emitStatus("closed");
          return;
        }
        this.emitStatus("reconnecting");
        this.scheduleRestart(recognition, 350);
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

  private scheduleRestart(recognition: SpeechRecognitionLike, delayMs: number): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      if (!this.wantRunning || this.recognition !== recognition) return;
      try {
        recognition.start();
      } catch {
        // Already starting — harmless. The pending start event remains the authority.
      }
    }, delayMs);
  }

  sendAudio(): void {
    // The browser owns the microphone for this provider.
  }

  async disconnect(): Promise<void> {
    this.wantRunning = false;
    this.recoveryUsed = 0;
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
