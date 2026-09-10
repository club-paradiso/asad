"use client";

/**
 * Chrome's built-in Translator API as a last-resort Korean → English path.
 *
 * This deliberately does NOT try to replace the interpretation model. It has
 * no sermon context, glossary memory, anticipation or rhetorical adaptation.
 * Its job is narrower and more valuable: when the cloud is unavailable or the
 * free quota is exhausted, show usable English instead of echoing Korean back
 * to a human interpreter.
 *
 * The API is feature-detected because it is currently a desktop-Chrome
 * capability rather than a baseline web API. No polyfill is used: a remote
 * polyfill would defeat the point of a zero-cost, on-device fallback.
 */
import type { ParsedInterpreterOutput } from "@/lib/schema";

export type BrowserTranslatorStatus = "unsupported" | "preparing" | "ready" | "failed";

export interface BrowserTranslatorSession {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}

interface DownloadProgressEvent {
  loaded: number;
}

interface CreateMonitor {
  addEventListener(
    type: "downloadprogress",
    listener: (event: DownloadProgressEvent) => void,
  ): void;
}

interface BrowserTranslatorFactory {
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    signal?: AbortSignal;
    monitor?: (monitor: CreateMonitor) => void;
  }): Promise<BrowserTranslatorSession>;
}

type TranslatorGlobal = typeof globalThis & {
  Translator?: BrowserTranslatorFactory;
};

export interface BrowserTranslatorPreparation {
  /** Resolves to null when unsupported, blocked, or the model download fails. */
  session: Promise<BrowserTranslatorSession | null>;
  /** True means the browser exposed the API and creation was attempted. */
  supported: boolean;
}

/**
 * Begin creation synchronously from the Start button's user gesture.
 *
 * Chrome may require user activation when the language pack is not downloaded.
 * Do not put an `await Translator.availability()` in front of this call: doing
 * so can squander the gesture we specifically need for `create()`.
 */
export function beginBrowserTranslatorPreparation(input: {
  signal?: AbortSignal;
  onDownloadProgress?: (progress: number) => void;
} = {}): BrowserTranslatorPreparation {
  const factory = (globalThis as TranslatorGlobal).Translator;
  if (!factory?.create) {
    return { supported: false, session: Promise.resolve(null) };
  }

  try {
    const session = factory
      .create({
        sourceLanguage: "ko",
        targetLanguage: "en",
        signal: input.signal,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            const progress = Math.max(0, Math.min(1, Number(event.loaded) || 0));
            input.onDownloadProgress?.(progress);
          });
        },
      })
      .then((translator) => translator)
      .catch(() => null);
    return { supported: true, session };
  } catch {
    // Some implementations can throw synchronously for permissions policy or
    // an unsupported language pair. Failure remains soft by design.
    return { supported: true, session: Promise.resolve(null) };
  }
}

/**
 * Translate one already-stabilised Korean unit and shape it for the existing
 * InterpreterOutput contract.
 */
export async function translateWithBrowserTranslator(
  translator: BrowserTranslatorSession,
  text: string,
  signal?: AbortSignal,
): Promise<ParsedInterpreterOutput | null> {
  const input = text.trim();
  if (!input || signal?.aborted) return null;

  try {
    const translated = (await translator.translate(input, { signal })).trim();
    if (!translated || signal?.aborted) return null;
    const chunks = chunkTranslation(translated);
    if (chunks.length === 0) return null;
    return {
      safeChunks: chunks.map((chunk) => ({ text: chunk, confidence: "medium" as const })),
      confidence: "medium",
    };
  } catch {
    return null;
  }
}

/**
 * Keep every fallback chunk inside `chunkDraftSchema`'s 400-character limit.
 * Normal live units are far shorter; the defensive splitter exists so a long
 * final flush cannot turn an otherwise successful local translation into a
 * schema-invalid result.
 */
export function chunkTranslation(text: string, maxChars = 380): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks: string[] = [];

  for (const sentence of sentences) {
    let rest = sentence.trim();
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars + 1);
      const splitAt = Math.max(window.lastIndexOf(" "), window.lastIndexOf(","));
      const at = splitAt >= Math.floor(maxChars * 0.55) ? splitAt : maxChars;
      chunks.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) chunks.push(rest);
  }

  // InterpreterOutput allows at most eight safe chunks. This only matters for
  // pathological multi-kilobyte final flushes; keep the latest material rather
  // than manufacturing an invalid ninth chunk.
  if (chunks.length <= 8) return chunks;
  return [...chunks.slice(0, 7), chunks.slice(7).join(" ").slice(0, maxChars).trim()].filter(Boolean);
}
