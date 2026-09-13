/**
 * Speech-to-text provider contract.
 *
 * tong-yuck is not tied to a vendor. Everything the live engine needs from a
 * recogniser is here: a connection lifecycle, a way to push audio, and two
 * callbacks — unstable partials and finalised text. Swapping provider is a
 * config change, not a rewrite.
 */
import type { StableTranscriptMeta } from "@/types";

export type { StableTranscriptMeta };

export type SttProviderId = "demo" | "webspeech" | "deepgram" | "openai";

export type SttStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "reconnecting"
  | "closed"
  | "error";

/**
 * A stable result plus whatever the recogniser knew about it. `meta` is
 * optional on both sides: providers that have nothing to add omit it, and a
 * caller that only wants the text can keep taking one argument.
 */
export type StableTranscriptHandler = (text: string, meta?: StableTranscriptMeta) => void;

export interface SttEventHandlers {
  onPartial?: (text: string) => void;
  onStable?: StableTranscriptHandler;
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
  onStable(callback: StableTranscriptHandler): void;
  onStatus(callback: (status: SttStatus, detail?: string) => void): void;
  onError(callback: (error: Error) => void): void;
}

export interface SttProviderOptions {
  /** BCP-47 language tag; any registry language. Korean when omitted. */
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
  onStable(callback: StableTranscriptHandler) {
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
  protected emitStable(text: string, meta?: StableTranscriptMeta) {
    if (!text.trim()) return;
    if (meta) this.handlers.onStable?.(text, meta);
    else this.handlers.onStable?.(text);
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
