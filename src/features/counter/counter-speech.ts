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
import { cloudSttCandidates, sttLanguageSupport } from "@/providers/stt/capability";
import { sttKeyterms } from "@/counter/domain-vocabulary";
import type { CounterProfileId } from "@/counter/profiles";
import { VoiceAttemptTrace, type VoiceFailureCategory } from "./voice-diagnostics";

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
  /** No configured recogniser covers this language. Typing is the real path. */
  | "unsupported-language"
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

/** Optional context that only sharpens recognition; never required to listen. */
export interface CounterSpeechContext {
  /** Desk vocabulary. Drives recogniser keyterms, nothing else. */
  profileId?: CounterProfileId;
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
  // Trailing silence before a turn is treated as finished. Raised from 1.4 s:
  // people at a counter pause mid-sentence to find a word, and ending their
  // turn there loses the half of the sentence that carried the date. Tapping
  // stop still ends the turn instantly, so the extra wait is opt-out.
  stableDelayMs: 1700,
};

// 16 kHz mono PCM16 is ~32 KB/s. Six seconds exceeds the provider connection
// deadline, so an ordinary startup can keep every syllable without unbounded
// memory growth. The buffer exists only until the streaming socket is ready.
const PRECONNECT_AUDIO_MAX_BYTES = 192_000;

/**
 * Hard ceiling on one streaming turn.
 *
 * Without it, a provider that stops sending results while audio keeps flowing
 * leaves the microphone open for as long as the tab lives. That is both a
 * privacy problem and a dead-end for the visitor, who sees "Listening" and no
 * way forward. Reaching the ceiling finalises whatever was heard rather than
 * throwing it away.
 */
const MAX_STREAMING_UTTERANCE_MS = 60_000;

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
  private trace: VoiceAttemptTrace | null = null;

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
    private readonly context: CounterSpeechContext = {},
  ) {}

  static isPotentiallyAvailable(
    dependencies: CounterSpeechDependencies = DEFAULT_DEPENDENCIES,
  ): boolean {
    return dependencies.browserSpeechSupported() || dependencies.cloudAudioSupported();
  }

  async listen(): Promise<CounterVoiceResult> {
    if (this.active) return { text: "", failure: "stopped", usedFallback: false };
    this.disposed = false;
    const trace = new VoiceAttemptTrace(this.language);
    this.trace = trace;
    this.handlers.onPhase("connecting");
    this.handlers.onPartial("");

    // Ask the capability table before opening anything. A language no
    // configured recogniser covers must not be answered with a microphone
    // that spins and then fails: typing is the working path, and saying so
    // immediately is the honest answer.
    const cloudCandidates = cloudSttCandidates(this.language);
    const browserSupportsLanguage =
      sttLanguageSupport("webspeech", this.language) !== "unsupported";
    const batchSupportsLanguage = sttLanguageSupport("hf", this.language) !== "unsupported";
    if (!cloudCandidates.length && !browserSupportsLanguage && !batchSupportsLanguage) {
      trace.finish("unsupported-language");
      return this.complete("", false, "unsupported-language");
    }

    let credentials: SttCredentials | null = null;
    let usedFallback = false;

    // Only pay for a credential round trip when some cloud recogniser could
    // actually serve this language.
    if (cloudCandidates.length && this.dependencies.cloudAudioSupported()) {
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
      trace.mark("credential");
      if (stoppedBeforeConnect || this.disposed) {
        trace.finish("aborted");
        return this.complete("", false, "stopped");
      }
    }

    const cloud = cloudProvider(credentials);
    // The configured vendor and the requested language can disagree. Opening
    // that socket anyway spends the whole connection deadline learning what
    // the capability table already knew.
    const cloudSupport = cloud ? sttLanguageSupport(cloud, this.language) : "unsupported";
    if (cloud && cloudSupport !== "unsupported" && this.dependencies.cloudAudioSupported()) {
      trace.provider(cloud, cloudSupport);
      try {
        const text = await this.attempt(cloud, credentials);
        trace.finish(text.trim() ? undefined : "no-speech");
        return this.complete(text, usedFallback);
      } catch (error) {
        const failure = toFailure(error);
        if (failure === "permission" || failure === "stopped") {
          trace.finish(failure === "permission" ? "permission" : "aborted");
          return this.complete("", usedFallback, failure);
        }
        usedFallback = true;
        trace.fallback();
        this.handlers.onFallback?.();
      }
    }

    if (browserSupportsLanguage && this.dependencies.browserSpeechSupported()) {
      trace.provider("webspeech", sttLanguageSupport("webspeech", this.language));
      try {
        const text = await this.attempt("webspeech");
        trace.finish(text.trim() ? undefined : "no-speech");
        return this.complete(text, usedFallback);
      } catch (error) {
        const failure = toFailure(error);
        if (failure === "permission" || failure === "stopped") {
          trace.finish(failure === "permission" ? "permission" : "aborted");
          return this.complete("", usedFallback, failure);
        }
        usedFallback = true;
        trace.fallback();
        this.handlers.onFallback?.();
      }
    }

    // Browser recognition is absent in Firefox and iOS Safari. This is a
    // short, one-utterance batch capture — never a hidden continuous upload.
    if (batchSupportsLanguage && this.dependencies.hfFallbackSupported()) {
      trace.provider("hf", "fallback-only");
      try {
        const text = await this.attemptHuggingFace();
        trace.finish(text.trim() ? undefined : "no-speech");
        return this.complete(text, usedFallback);
      } catch (error) {
        const failure = toFailure(error);
        trace.finish(diagnosticCategory(failure));
        return this.complete("", usedFallback, failure);
      }
    }

    // Something in the stack can transcribe this language — the guard at the
    // top of listen() already returned otherwise — so reaching here means this
    // browser or device could not get to any of it.
    trace.finish("browser-unsupported");
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
    this.handlers.onPhase(
      failure === "unavailable" || failure === "unsupported-language" ? "unavailable" : "idle",
    );
    if (!clean && !failure) failure = "no-speech";
    this.trace = null;
    return { text: clean, failure, usedFallback };
  }

  private async attempt(
    providerId: Exclude<SttProviderId, "demo">,
    credentials?: SttCredentials | null,
  ): Promise<string> {
    if (this.disposed) throw new AttemptError("stopped");

    const trace = this.trace;
    // The hint channel every vendor in the stack exposes and Counter Mode was
    // not using. These are the twenty terms an immigration desk repeats all
    // day; a generic model gets them wrong far more often than it should.
    const hints = sttKeyterms(this.language, this.context.profileId);
    const provider = this.dependencies.createProvider({
      provider: providerId,
      language: this.language,
      credentials: credentials ?? undefined,
      utterance: true,
      ...(hints.length ? { hints } : {}),
    });

    let microphone: MicrophoneHandle | null = null;
    let providerReady = false;
    let captureReady = !provider.needsAudio;
    let listeningAnnounced = false;
    let stableText = "";
    let partialText = "";
    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTurnTimer: ReturnType<typeof setTimeout> | null = null;
    const preconnectFrames: ArrayBuffer[] = [];
    let preconnectBytes = 0;

    const announceListening = () => {
      if (listeningAnnounced || !providerReady || !captureReady) return;
      listeningAnnounced = true;
      trace?.mark("listening");
      this.handlers.onPhase("listening");
    };
    const flushPreconnectAudio = () => {
      if (!providerReady || !provider.needsAudio || !preconnectFrames.length) return;
      for (const frame of preconnectFrames) provider.sendAudio(frame);
      preconnectFrames.length = 0;
      preconnectBytes = 0;
    };
    const acceptAudio = (frame: ArrayBuffer) => {
      trace?.mark("first-audio");
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
      if (maxTurnTimer) clearTimeout(maxTurnTimer);
      maxTurnTimer = null;
      resolveUtterance(currentText());
    };

    provider.onPartial((text) => {
      if (text.trim()) trace?.mark("first-partial");
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
        trace?.mark("provider-ready");
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
            trace?.mark("capture");
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
      maxTurnTimer = setTimeout(finish, MAX_STREAMING_UTTERANCE_MS);

      if (stopped && !providerReady) throw new AttemptError("stopped");
      const transcript = await utterancePromise;
      if (cancelled) throw new AttemptError("stopped");
      return transcript;
    } finally {
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = null;
      if (maxTurnTimer) clearTimeout(maxTurnTimer);
      maxTurnTimer = null;
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
      this.trace?.mark("capture");
      this.trace?.mark("listening");
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

/** Map a user-facing failure onto the diagnostic taxonomy. */
function diagnosticCategory(failure: CounterVoiceFailure): VoiceFailureCategory {
  switch (failure) {
    case "permission":
      return "permission";
    case "no-speech":
      return "no-speech";
    case "stopped":
      return "aborted";
    case "unsupported-language":
      return "unsupported-language";
    case "unavailable":
      return "browser-unsupported";
    default:
      return "provider";
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
