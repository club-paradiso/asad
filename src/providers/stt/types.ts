/**
 * Speech-to-text provider contract.
 *
 * tong-yuck is not tied to a vendor. Everything the live engine needs from a
 * recogniser is here: a connection lifecycle, a way to push audio, and two
 * callbacks — unstable partials and finalised text. Swapping provider is a
 * config change, not a rewrite.
 */
export type SttProviderId = "demo" | "webspeech" | "deepgram" | "openai";

export type SttStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "reconnecting"
  | "closed"
  | "error";

export interface SttEventHandlers {
  onPartial?: (text: string) => void;
  onStable?: (text: string) => void;
  onStatus?: (status: SttStatus, detail?: string) => void;
  onError?: (error: Error) => void;
}

export interface SpeechProvider {
  readonly id: SttProviderId;
  /** Whether this provider needs microphone audio pushed to it. */
  readonly needsAudio: boolean;
  connect(): Promise<void>;
  sendAudio(chunk: ArrayBuffer): void;
  disconnect(): Promise<void>;
  onPartial(callback: (text: string) => void): void;
  onStable(callback: (text: string) => void): void;
  onStatus(callback: (status: SttStatus, detail?: string) => void): void;
  onError(callback: (error: Error) => void): void;
}

export interface SttProviderOptions {
  /** BCP-47 language tag; Korean throughout the MVP. */
  language?: string;
  /**
   * Stop after one natural utterance instead of continuously restarting.
   * Counter Mode uses this while Live Mode keeps the continuous default.
   */
  utterance?: boolean;
  /** Terminology hints, where the provider supports custom vocabulary. */
  hints?: string[];
  /** Signed connection details fetched from `/api/stt/token`. */
  credentials?: SttCredentials;
}

export interface SttCredentials {
  provider: SttProviderId;
  /** Short-lived token. Never the account key. */
  token?: string;
  url?: string;
  model?: string;
  expiresAt?: number;
}

/**
 * Small base class carrying the callback plumbing so each provider only writes
 * its transport.
 */
export abstract class BaseSpeechProvider implements SpeechProvider {
  abstract readonly id: SttProviderId;
  abstract readonly needsAudio: boolean;

  protected handlers: SttEventHandlers = {};

  onPartial(callback: (text: string) => void) {
    this.handlers.onPartial = callback;
  }
  onStable(callback: (text: string) => void) {
    this.handlers.onStable = callback;
  }
  onStatus(callback: (status: SttStatus, detail?: string) => void) {
    this.handlers.onStatus = callback;
  }
  onError(callback: (error: Error) => void) {
    this.handlers.onError = callback;
  }

  protected emitPartial(text: string) {
    if (text.trim()) this.handlers.onPartial?.(text);
  }
  protected emitStable(text: string) {
    if (text.trim()) this.handlers.onStable?.(text);
  }
  protected emitStatus(status: SttStatus, detail?: string) {
    this.handlers.onStatus?.(status, detail);
  }
  protected emitError(error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    this.handlers.onError?.(err);
  }

  abstract connect(): Promise<void>;
  abstract sendAudio(chunk: ArrayBuffer): void;
  abstract disconnect(): Promise<void>;
}
