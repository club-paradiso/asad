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

/**
 * How many times a serious-but-temporary failure is forgiven before the
 * console admits the microphone is not coming back.
 *
 * Bounded on purpose: retrying forever leaves the UI claiming to listen to a
 * microphone that is dead, which is the failure this budget replaced.
 */
const RECOVERY_ATTEMPTS = 4;
/** Backoff per attempt. Long enough for a device switch to settle. */
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
  /** Recoverable failures spent so far. Reset by any successful listen. */
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
    recognition.lang = this.options.language ?? "ko-KR";
    recognition.continuous = !this.options.utterance;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    this.recognition = recognition;

    await new Promise<void>((resolve, reject) => {
      let connected = false;
      let settled = false;

      recognition.onstart = () => {
        connected = true;
        // Listening again means the trouble passed. Spend the budget on the
        // NEXT run of failures, not on a tally accumulated across the hour.
        this.recoveryUsed = 0;
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

        // A recoverable failure is only fatal once the budget is spent. This is
        // the difference between "the headset switched" and "the microphone is
        // gone", and nothing in the error code itself distinguishes them —
        // only whether trying again works.
        const recoverable = RECOVERABLE_ERRORS.has(code);
        const budgetLeft = recoverable && this.recoveryUsed < RECOVERY_ATTEMPTS;
        const fatal = PERMANENT_ERRORS.has(code) || (recoverable && !budgetLeft);

        const error = new Error(
          fatal && recoverable
            ? `Speech recognition stopped after ${RECOVERY_ATTEMPTS} attempts to recover: ${code}`
            : `Speech recognition error: ${code}`,
        );

        // Permission and hardware errors do not heal by calling start() every
        // 250 ms. Stop the restart loop and give the UI a real retry action.
        if (fatal) this.wantRunning = false;

        // A recoverable failure the interpreter never sees is the point: they
        // are mid-sentence. Report it as a health blip, not as an error banner
        // over the English they are reading.
        if (!fatal) this.recoveryUsed += 1;
        else this.emitError(error);

        this.emitStatus(fatal ? "error" : "reconnecting", code);

        // `onend` normally drives the restart, but a recogniser that errored
        // without ever starting may never fire it. Schedule the retry here so
        // the budget is actually spent trying rather than waiting.
        if (!fatal && recoverable) {
          this.scheduleRestart(recognition, RECOVERY_BACKOFF_MS[this.recoveryUsed - 1] ?? 6000);
        }

        // A connection that never reached onstart should fail its start()
        // promise. This keeps the session out of the dishonest "running"
        // phase and makes the retry button available immediately.
        //
        // Only once the failure is final, though: rejecting while a retry is
        // still scheduled would end the session on the first blip, which is
        // the whole behaviour the recovery budget exists to prevent.
        if (fatal && !connected && !settled) {
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

        // A Counter turn is one utterance. Natural silence is completion, not
        // a reason to restart the recogniser as Live Mode does.
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

  /**
   * Bring the recogniser back after it stopped.
   *
   * One place, because two callers need it and they must not disagree: the
   * routine silence restart (`onend`) and the recovery retry after a serious
   * failure. A second scheduled restart always replaces the first, so a burst
   * of errors produces one pending attempt rather than a pile-up.
   */
  private scheduleRestart(recognition: SpeechRecognitionLike, delayMs: number): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      if (!this.wantRunning || this.recognition !== recognition) return;
      try {
        recognition.start();
      } catch {
        // Already starting — harmless. The pending start event remains the
        // authority on whether listening actually resumed.
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
