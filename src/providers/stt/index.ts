/**
 * STT provider factory.
 *
 * The engine asks for a provider by id and receives something that satisfies
 * `SpeechProvider`. Nothing downstream knows or cares which vendor answered.
 */
import type { DemoScript } from "@/demo/types";
import { DemoSpeechProvider, type DemoSpeechOptions } from "./demo";
import { DeepgramSpeechProvider } from "./deepgram";
import { OpenAiSpeechProvider } from "./openai";
import { WebSpeechProvider } from "./webspeech";
import { guardedFetch } from "@/lib/session-client";
import { COUNTER_TOKEN_HEADER } from "@/counter/access-shared";
import type { SpeechProvider, SttCredentials, SttProviderId, SttProviderOptions } from "./types";

export * from "./types";
export { MicrophoneCapture, Pcm16UtteranceBuffer } from "./audio";
export { transcribeWithHuggingFace } from "./hf";
export { DemoSpeechProvider, derivePartials } from "./demo";
export { WebSpeechProvider } from "./webspeech";
export {
  ensureMicrophonePermission,
  getMicrophonePermissionState,
  type MicrophonePermissionReadiness,
  type MicrophonePermissionState,
} from "./microphone-permission";

export interface CreateSttOptions extends SttProviderOptions {
  provider: SttProviderId;
  /** Required when `provider` is `demo`. */
  demo?: Omit<DemoSpeechOptions, "script"> & { script: DemoScript };
}

export function createSpeechProvider(options: CreateSttOptions): SpeechProvider {
  switch (options.provider) {
    case "demo": {
      if (!options.demo) throw new Error("Demo provider requires a script.");
      return new DemoSpeechProvider(options.demo);
    }
    case "webspeech":
      return new WebSpeechProvider(options);
    case "deepgram":
      return new DeepgramSpeechProvider(options);
    case "openai":
      return new OpenAiSpeechProvider(options);
    default: {
      const exhaustive: never = options.provider;
      throw new Error(`Unknown speech provider: ${String(exhaustive)}`);
    }
  }
}

/** Human-facing description of each provider, used by the mode picker. */
export const STT_PROVIDER_INFO: Record<
  SttProviderId,
  { label: string; detail: string; needsKey: boolean; needsMic: boolean }
> = {
  demo: {
    label: "Demo",
    detail: "Scripted session — no microphone, no key, works offline",
    needsKey: false,
    needsMic: false,
  },
  webspeech: {
    label: "Browser",
    detail: "Browser-managed recognition — may use the browser vendor's cloud service; no key needed",
    needsKey: false,
    needsMic: true,
  },
  deepgram: {
    label: "Deepgram",
    detail: "Streaming Korean with true interim results and terminology hints",
    needsKey: true,
    needsMic: true,
  },
  openai: {
    label: "OpenAI",
    detail: "Realtime transcription over WebSocket",
    needsKey: true,
    needsMic: true,
  },
};

type SttUsage = "live" | "counter";
type CounterAccess = { code: string; token: string };

interface PrefetchedCredentials {
  createdAt: number;
  maxAgeMs: number;
  promise: Promise<SttCredentials | null>;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

// Unknown/opaque credentials get only a short speculative cache. Providers that
// return an explicit expiry (Deepgram does for its scoped temporary key) can be
// kept ready longer, but still only for a bounded window and never through the
// final five seconds of their declared lifetime.
const PREFETCH_DEFAULT_MAX_AGE_MS = 20_000;
const PREFETCH_EXPIRING_MAX_AGE_MS = 5 * 60_000;
const PREFETCH_EXPIRY_SAFETY_MS = 5_000;
const prefetchedCredentials = new Map<string, PrefetchedCredentials>();

function prefetchKey(language: string | undefined, usage: SttUsage, access?: CounterAccess) {
  return [usage, language?.trim().toLowerCase() ?? "", access?.code ?? "", access?.token ?? ""].join("|");
}

function prefetchFresh(entry: PrefetchedCredentials): boolean {
  return Date.now() - entry.createdAt < entry.maxAgeMs;
}

function schedulePrefetchCleanup(key: string, entry: PrefetchedCredentials) {
  if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer);
  const elapsed = Date.now() - entry.createdAt;
  const remaining = Math.max(0, entry.maxAgeMs - elapsed);
  entry.cleanupTimer = setTimeout(() => {
    if (prefetchedCredentials.get(key) === entry) prefetchedCredentials.delete(key);
  }, remaining);
}

function updatePrefetchLifetime(
  key: string,
  entry: PrefetchedCredentials,
  credentials: SttCredentials | null,
) {
  if (credentials?.expiresAt) {
    const usableLifetime = Math.max(
      0,
      credentials.expiresAt - entry.createdAt - PREFETCH_EXPIRY_SAFETY_MS,
    );
    entry.maxAgeMs = Math.min(PREFETCH_EXPIRING_MAX_AGE_MS, usableLifetime);
  }
  if (prefetchedCredentials.get(key) === entry) schedulePrefetchCleanup(key, entry);
}

async function requestSttCredentials(
  language?: string,
  signal?: AbortSignal,
  usage: SttUsage = "live",
  counterAccess?: CounterAccess,
): Promise<SttCredentials | null> {
  const response = await guardedFetch("/api/stt/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(counterAccess ? { [COUNTER_TOKEN_HEADER]: counterAccess.token } : {}),
    },
    body: JSON.stringify({ language, usage, code: counterAccess?.code }),
    signal,
  });
  if (!response.ok) return null;
  const data = (await response.json()) as Partial<SttCredentials> & { provider?: string };
  if (!data?.provider) return null;
  return data as SttCredentials;
}

/**
 * Start the Counter credential request before the user taps the mic.
 *
 * The result is one-shot. Opaque credentials expire from the in-memory prefetch
 * after 20 seconds; a credential with an explicit expiry may remain ready for
 * up to five minutes, but never beyond its own safe lifetime. Network/provider
 * errors are swallowed because prewarming is only an optimisation.
 */
export function prefetchSttCredentials(
  language: string,
  counterAccess: CounterAccess,
): void {
  const key = prefetchKey(language, "counter", counterAccess);
  const existing = prefetchedCredentials.get(key);
  if (existing && prefetchFresh(existing)) return;
  if (existing?.cleanupTimer) clearTimeout(existing.cleanupTimer);

  const entry: PrefetchedCredentials = {
    createdAt: Date.now(),
    maxAgeMs: PREFETCH_DEFAULT_MAX_AGE_MS,
    promise: Promise.resolve(null),
    cleanupTimer: null,
  };
  entry.promise = requestSttCredentials(language, undefined, "counter", counterAccess)
    .catch(() => null)
    .then((credentials) => {
      updatePrefetchLifetime(key, entry, credentials);
      return credentials;
    });
  prefetchedCredentials.set(key, entry);
  schedulePrefetchCleanup(key, entry);
}

function aborted(signal?: AbortSignal): never {
  throw signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

async function consumePrefetched(
  entry: PrefetchedCredentials,
  signal?: AbortSignal,
): Promise<SttCredentials | null> {
  if (!signal) return entry.promise;
  if (signal.aborted) return aborted(signal);

  return await new Promise<SttCredentials | null>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Fetch short-lived connection details. Returns `null` when unconfigured.
 *
 * Guarded, because this route mints credentials against a billed recogniser
 * account and the credential outlives the request that obtained it.
 */
export async function fetchSttCredentials(
  language?: string,
  signal?: AbortSignal,
  usage: SttUsage = "live",
  counterAccess?: CounterAccess,
): Promise<SttCredentials | null> {
  if (usage === "counter" && counterAccess) {
    const key = prefetchKey(language, usage, counterAccess);
    const entry = prefetchedCredentials.get(key);
    prefetchedCredentials.delete(key);
    if (entry?.cleanupTimer) clearTimeout(entry.cleanupTimer);

    if (entry && prefetchFresh(entry)) {
      const prefetched = await consumePrefetched(entry, signal);
      if (
        !prefetched?.expiresAt ||
        prefetched.expiresAt > Date.now() + PREFETCH_EXPIRY_SAFETY_MS
      ) {
        return prefetched;
      }
    }
  }

  return requestSttCredentials(language, signal, usage, counterAccess);
}
