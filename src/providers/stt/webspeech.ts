/**
 * Browser-native speech recognition.
 *
 * No key, no server, no audio leaves the browser API boundary. This is the
 * zero-configuration live path and the graceful fallback when a cloud provider
 * is unreachable.
 */
import { BaseSpeechProvider, type SttProviderId, type SttProviderOptions } from "./types";
import { webSpeechLanguage } from "./language";
import { joinBrowserResultParts, pickSpeechAlternative } from "./transcript";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
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
const PERMANENT_ERRORS = new Set(["not-allowed", "language-not-supported", "language-unavailable"]);
const RECOVERABLE_ERRORS = new Set(["service-not-allowed", "audio-capture", "network"]);
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

function alternativesFor(result: SpeechRecognitionResultLike): string[] {
  const alternatives: Array<{ transcript: string; confidence: number; index: number }> = [];
  for (let i = 0; i < result.length; i += 1) {
    const alternative = result[i];
    if (!alternative?.transcript) continue;
    alternatives.push({
      transcript: alternative.transcript,
      confidence:
        typeof alternative.confidence === "number" && Number.isFinite(alternative.confidence)
          ? alternative.confidence
          : -1,
      index: i,
    });
  }
  alternatives.sort((a, b) => {
    const confidenceOrder = b.confidence - a.confidence;
    return confidenceOrder !== 0 ? confidenceOrder : a.index - b.index;
  });
  return alternatives.map((alternative) => alternative.transcript);
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
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    this.recognition = recognition;

    await new Promise<void>((resolve, reject) => {
      let connected = false;
      let settled = false;
      let hasResult = false;

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
        const interim: string[] = [];
        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = pickSpeechAlternative(alternativesFor(result), this.options.language);
          if (!text) continue;
          hasResult = true;
          if (result.isFinal) {
            if (i >= event.resultIndex) this.emitStable(text);
          } else {
            interim.push(text);
          }
        }
        const partial = joinBrowserResultParts(interim, this.options.language);
        if (partial) this.emitPartial(partial);
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
        if (this.options.utterance && !hasResult) {
          this.wantRunning = false;
          this.emitStatus("closed");
          return;
        }
        this.emitStatus("reconnecting");
        this.scheduleRestart(recognition, this.options.utterance ? 180 : 350);
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
        // Already starting; the pending start event remains authoritative.
      }
    }, delayMs);
  }

  sendAudio(): void {}

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
