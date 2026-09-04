/**
 * One-utterance speech controller for Counter Mode.
 *
 * It reuses the application's provider factory and microphone capture, but
 * deliberately owns a different lifecycle from Live Mode: connect, listen for
 * one turn, dispose every audio resource, then return a transcript. Provider
 * choice is internal and a failed cloud setup falls back to browser speech.
 */
import {
  MicrophoneCapture,
  Pcm16UtteranceBuffer,
  WebSpeechProvider,
  createSpeechProvider,
  fetchSttCredentials,
  transcribeWithHuggingFace,
  type CreateSttOptions,
  type SpeechProvider,
  type SttCredentials,
  type SttProviderId,
} from "@/providers/stt";
import { joinTranscriptParts } from "@/providers/stt/transcript";
import { findLanguage } from "@/counter/languages";

export type CounterVoicePhase =
  | "idle"
  | "connecting"
  | "listening"
  | "finishing"
  | "unavailable";

export type CounterVoiceFailure =
  | "permission"
  | "no-speech"
  | "unavailable"
  | "failed"
  | "stopped";

export interface CounterVoiceResult {
  text: string;
  failure?: CounterVoiceFailure;
  usedFallback: boolean;
}

interface MicrophoneHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CounterSpeechDependencies {
  fetchCredentials(
    language: string,
    access?: { code: string; token: string },
    signal?: AbortSignal,
  ): Promise<SttCredentials | null>;
  createProvider(options: CreateSttOptions): SpeechProvider;
  createMicrophone(options: {
    onFrame: (frame: ArrayBuffer) => void;
    onError: (error: Error) => void;
  }): MicrophoneHandle;
  browserSpeechSupported(): boolean;
  cloudAudioSupported(): boolean;
  hfFallbackSupported(): boolean;
  transcribeHf(input: {
    pcm16: ArrayBuffer;
    language: string;
    code?: string;
    counterToken?: string;
  }): Promise<string>;
  connectTimeoutMs: number;
  stableDelayMs: number;
}

const DEFAULT_DEPENDENCIES: CounterSpeechDependencies = {
  fetchCredentials: (language, access, signal) =>
    fetchSttCredentials(language, signal, "counter", access),
  createProvider: (options) => createSpeechProvider(options),
  createMicrophone: (options) => new MicrophoneCapture(options),
  browserSpeechSupported: () => WebSpeechProvider.isSupported(),
  cloudAudioSupported: () => MicrophoneCapture.isSupported(),
  hfFallbackSupported: () => MicrophoneCapture.isSupported(),
  transcribeHf: transcribeWithHuggingFace,
  connectTimeoutMs: 4500,
  stableDelayMs: 1400,
};

// 16 kHz mono PCM16 is ~32 KB/s. Six seconds exceeds the provider connection
// deadline, so an ordinary startup can keep every syllable without unbounded
// memory growth. The buffer exists only until the streaming socket is ready.
const PRECONNECT_AUDIO_MAX_BYTES = 192_000;

function utteranceDelay(language: string, baseDelay: number): number {
  // Tests and explicit callers may deliberately request an immediate finish.
  if (baseDelay <= 100) return baseDelay;
  const base = language.split("-")[0]?.toLowerCase();
  switch (base) {
    case "zh":
      return Math.max(baseDelay, 1900);
    case "th":
    case "km":
    case "my":
      return Math.max(baseDelay, 1800);
    case "ja":
    case "ar":
    case "ur":
      return Math.max(baseDelay, 1700);
    case "vi":
    case "mn":
    case "uz":
    case "ne":
      return Math.max(baseDelay, 1600);
    case "ko":
      return Math.max(baseDelay, 1500);
    default:
      return baseDelay;
  }
}

class AttemptError extends Error {
  constructor(readonly code: CounterVoiceFailure) {
    super(code);
  }
}

interface ActiveAttempt {
  stop(): void;
  cancel(): void;
}

const cloudProvider = (
  credentials: SttCredentials | null,
): "deepgram" | "openai" | null => {
  if (!credentials?.token) return null;
  return credentials.provider === "deepgram" || credentials.provider === "openai"
    ? credentials.provider
    : null;
};

export class CounterSpeechController {
  private active: ActiveAttempt | null = null;
  private disposed = false;

  constructor(
    private readonly language: string,
    private readonly handlers: {
      onPhase: (phase: CounterVoicePhase) => void;
      onPartial: (text: string) => void;
      onFallback?: () => void;
    },
    private readonly dependencies: CounterSpeechDependencies = DEFAULT_DEPENDENCIES,
    private readonly counterCode?: string,
    private readonly counterToken?: string,
  ) {}

  static isPotentiallyAvailable(
    dependencies: CounterSpeechDependencies = DEFAULT_DEPENDENCIES,
  ): boolean {
    return dependencies.browserSpeechSupported() || dependencies.cloudAudioSupported();
  }

  async listen(): Promise<CounterVoiceResult> {
    if (this.active) return { text: "", failure: "stopped", usedFallback: false };
    this.disposed = false;
    this.handlers.onPhase("connecting");
    this.handlers.onPartial("");

    let credentials: SttCredentials | null = null;
    const credentialController = new AbortController();
    let stoppedBeforeConnect = false;
    this.active = {
      stop: () => {
        stoppedBeforeConnect = true;
        credentialController.abort();
        this.handlers.onPhase("finishing");
      },
      cancel: () => {
        stoppedBeforeConnect = true;
        credentialController.abort();
      },
    };
    try {
      credentials = await this.dependencies.fetchCredentials(
        this.language,
        this.counterCode && this.counterToken
          ? { code: this.counterCode, token: this.counterToken }
          : undefined,
        credentialController.signal,
      );
    } catch {
      // Credentials are an optimisation. Browser speech remains a valid path.
    }
    this.active = null;
    if (stoppedBeforeConnect || this.disposed) {
      return this.complete("", false, "stopped");
    }

    const cloud = cloudProvider(credentials);
    let usedFallback = false;

    if (cloud && this.dependencies.cloudAudioSupported()) {
      try {
        const text = await this.attempt(cloud, credentials);
        return this.complete(text, usedFallback);
      } catch (error) {
        const failure = toFailure(error);
        if (failure === "permission" || failure === "stopped") {
          return this.complete("", usedFallback, failure);
        }
        usedFallback = true;
        this.handlers.onFallback?.();
      }
    }

    const languageSupportsBrowserSpeech = findLanguage(this.language)?.speechSupported ?? true;
    if (languageSupportsBrowserSpeech && this.dependencies.browserSpeechSupported()) {
      try {
        const text = await this.attempt("webspeech");
        return this.complete(text, usedFallback);
      } catch (error) {
        const failure = toFailure(error);
        if (failure === "permission" || failure === "stopped") {
          return this.complete("", usedFallback, failure);
        }
        usedFallback = true;
        this.handlers.onFallback?.();
      }
    }

    // Browser recognition is absent in Firefox and iOS Safari. This is a
    // short, one-utterance batch capture — never a hidden continuous upload.
    if (this.dependencies.hfFallbackSupported()) {
      try {
        const text = await this.attemptHuggingFace();
        return this.complete(text, usedFallback);
      } catch (error) {
        return this.complete("", usedFallback, toFailure(error));
      }
    }

    return this.complete("", usedFallback, "unavailable");
  }

  stop() {
    this.active?.stop();
  }

  dispose() {
    this.disposed = true;
    this.active?.cancel();
    this.active = null;
  }

  private complete(
    text: string,
    usedFallback: boolean,
    failure?: CounterVoiceFailure,
  ): CounterVoiceResult {
    const clean = text.trim();
    this.handlers.onPartial("");
    this.handlers.onPhase(failure === "unavailable" ? "unavailable" : "idle");
    if (!clean && !failure) failure = "no-speech";
    return { text: clean, failure, usedFallback };
  }

  private async attempt(
    providerId: Exclude<SttProviderId, "demo">,
    credentials?: SttCredentials | null,
  ): Promise<string> {
    if (this.disposed) throw new AttemptError("stopped");

    const provider = this.dependencies.createProvider({
      provider: providerId,
      language: this.language,
      credentials: credentials ?? undefined,
      utterance: true,
    });

    let microphone: MicrophoneHandle | null = null;
    let providerReady = false;
    let captureReady = !provider.needsAudio;
    let listeningAnnounced = false;
    let stableText = "";
    let partialText = "";
    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    const preconnectFrames: ArrayBuffer[] = [];
    let preconnectBytes = 0;

    const announceListening = () => {
      if (listeningAnnounced || !providerReady || !captureReady) return;
      listeningAnnounced = true;
      this.handlers.onPhase("listening");
    };
    const flushPreconnectAudio = () => {
      if (!providerReady || !provider.needsAudio || !preconnectFrames.length) return;
      for (const frame of preconnectFrames) provider.sendAudio(frame);
      preconnectFrames.length = 0;
      preconnectBytes = 0;
    };
    const acceptAudio = (frame: ArrayBuffer) => {
      if (providerReady) {
        provider.sendAudio(frame);
        return;
      }
      // People speak as soon as they tap. Keep the startup audio locally while
      // the provider socket is connecting, then flush it in original order.
      // The connection timeout is shorter than this bounded buffer window.
      const copy = frame.slice(0);
      preconnectFrames.push(copy);
      preconnectBytes += copy.byteLength;
      while (preconnectBytes > PRECONNECT_AUDIO_MAX_BYTES && preconnectFrames.length > 1) {
        const dropped = preconnectFrames.shift();
        preconnectBytes -= dropped?.byteLength ?? 0;
      }
    };

    let resolveConnected!: () => void;
    let rejectConnected!: (error: Error) => void;
    const connectedPromise = new Promise<void>((resolve, reject) => {
      resolveConnected = resolve;
      rejectConnected = reject;
    });

    let resolveUtterance!: (text: string) => void;
    let rejectUtterance!: (error: Error) => void;
    const utterancePromise = new Promise<string>((resolve, reject) => {
      resolveUtterance = resolve;
      rejectUtterance = reject;
    });

    const currentText = () => joinTranscriptParts([stableText, partialText], this.language);
    const fail = (error: unknown) => {
      const attemptError = normaliseAttemptError(error);
      if (providerReady) rejectUtterance(attemptError);
      else rejectConnected(attemptError);
    };
    const finish = () => {
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = null;
      resolveUtterance(currentText());
    };

    provider.onPartial((text) => {
      // A new interim means the speaker continued. Do not let the previous
      // stable segment's silence timer finalize in the middle of this phrase.
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = null;
      partialText = text.trim();
      this.handlers.onPartial(joinTranscriptParts([stableText, partialText], this.language));
    });
    provider.onStable((text) => {
      const clean = text.trim();
      if (!clean) return;
      stableText = joinTranscriptParts([stableText, clean], this.language);
      partialText = "";
      this.handlers.onPartial(stableText);
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = setTimeout(
        finish,
        utteranceDelay(this.language, this.dependencies.stableDelayMs),
      );
    });
    provider.onError(fail);
    provider.onStatus((status) => {
      if (status === "listening") {
        providerReady = true;
        flushPreconnectAudio();
        resolveConnected();
        announceListening();
      } else if (status === "error") {
        fail(new AttemptError("failed"));
      } else if (status === "closed" && providerReady) {
        finish();
      }
    });

    let stopped = false;
    let cancelled = false;
    this.active = {
      stop: () => {
        stopped = true;
        this.handlers.onPhase("finishing");
        if (providerReady) finish();
        else rejectConnected(new AttemptError("stopped"));
        void provider.disconnect().catch(() => {});
      },
      cancel: () => {
        stopped = true;
        cancelled = true;
        const error = new AttemptError("stopped");
        if (providerReady) resolveUtterance("");
        else rejectConnected(error);
        void provider.disconnect().catch(() => {});
        void microphone?.stop().catch(() => {});
      },
    };

    try {
      // Start the provider and microphone together. If the human speaks before
      // the socket reaches `listening`, acceptAudio buffers those frames locally
      // instead of deleting the first word of the sentence. Browser-managed
      // Web Speech has no app-owned audio stream and simply follows its own
      // start lifecycle.
      const connection = withTimeout(
        Promise.all([provider.connect(), connectedPromise]).then(() => undefined),
        this.dependencies.connectTimeoutMs,
      );

      let capture: Promise<void> = Promise.resolve();
      if (provider.needsAudio) {
        microphone = this.dependencies.createMicrophone({
          onFrame: acceptAudio,
          onError: fail,
        });
        capture = microphone.start().then(
          () => {
            captureReady = true;
            announceListening();
          },
          (error) => {
            throw normaliseAttemptError(error);
          },
        );
      }

      await Promise.all([connection, capture]);
      flushPreconnectAudio();
      announceListening();

      if (stopped && !providerReady) throw new AttemptError("stopped");
      const transcript = await utterancePromise;
      if (cancelled) throw new AttemptError("stopped");
      return transcript;
    } finally {
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = null;
      preconnectFrames.length = 0;
      preconnectBytes = 0;
      await microphone?.stop().catch(() => {});
      await provider.disconnect().catch(() => {});
      this.active = null;
    }
  }

  /** Capture only one spoken turn, then submit its in-memory PCM buffer once. */
  private async attemptHuggingFace(): Promise<string> {
    if (this.disposed) throw new AttemptError("stopped");

    const audio = new Pcm16UtteranceBuffer();
    let microphone: MicrophoneHandle | null = null;
    let heardSpeech = false;
    let stopped = false;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let resolveCapture!: () => void;
    let rejectCapture!: (error: Error) => void;
    const capturePromise = new Promise<void>((resolve, reject) => {
      resolveCapture = resolve;
      rejectCapture = reject;
    });
    const finish = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = null;
      resolveCapture();
    };

    this.active = {
      stop: () => {
        stopped = true;
        this.handlers.onPhase("finishing");
        finish();
      },
      cancel: () => {
        stopped = true;
        rejectCapture(new AttemptError("stopped"));
        void microphone?.stop().catch(() => {});
      },
    };

    try {
      microphone = this.dependencies.createMicrophone({
        onFrame: (frame) => {
          if (!audio.append(frame)) {
            finish();
            return;
          }
          // A small RMS-free amplitude check is enough to end a Counter turn
          // after speech. It is deliberately not speech detection and is never
          // transmitted as telemetry.
          const samples = new Int16Array(frame);
          let peak = 0;
          for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
          if (peak > 450) {
            heardSpeech = true;
            if (silenceTimer) clearTimeout(silenceTimer);
            silenceTimer = setTimeout(finish, this.dependencies.stableDelayMs);
          }
        },
        onError: (error) => rejectCapture(normaliseAttemptError(error)),
      });
      await microphone.start();
      this.handlers.onPhase("listening");
      // A model fallback must not leave a visible spinner running indefinitely.
      maxTimer = setTimeout(finish, 30_000);
      await capturePromise;
      if (stopped && !heardSpeech) throw new AttemptError("stopped");
      if (!heardSpeech || audio.byteLength === 0) return "";
      this.handlers.onPhase("finishing");
      // Release the microphone before the potentially slow batch request. A
      // finished turn must never keep capturing while audio is in flight.
      await microphone.stop().catch(() => {});
      microphone = null;
      return await this.dependencies.transcribeHf({
        pcm16: audio.toArrayBuffer(),
        language: this.language,
        code: this.counterCode,
        counterToken: this.counterToken,
      });
    } finally {
      if (silenceTimer) clearTimeout(silenceTimer);
      if (maxTimer) clearTimeout(maxTimer);
      await microphone?.stop().catch(() => {});
      audio.clear();
      this.active = null;
    }
  }
}

function toFailure(error: unknown): CounterVoiceFailure {
  return error instanceof AttemptError ? error.code : normaliseAttemptError(error).code;
}

function normaliseAttemptError(error: unknown): AttemptError {
  if (error instanceof AttemptError) return error;
  if (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError")
  ) {
    return new AttemptError("permission");
  }
  if (error instanceof Error && /not.?allowed|permission/i.test(error.message)) {
    return new AttemptError("permission");
  }
  return new AttemptError("failed");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AttemptError("failed")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
