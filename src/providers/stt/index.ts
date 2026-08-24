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
import type { SpeechProvider, SttCredentials, SttProviderId, SttProviderOptions } from "./types";

export * from "./types";
export { MicrophoneCapture } from "./audio";
export { DemoSpeechProvider, derivePartials } from "./demo";
export { WebSpeechProvider } from "./webspeech";

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
    detail: "On-device recognition — no key needed. Best in Chrome; partial in Safari",
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

/** Fetch short-lived connection details. Returns `null` when unconfigured. */
export async function fetchSttCredentials(
  signal?: AbortSignal,
): Promise<SttCredentials | null> {
  const response = await fetch("/api/stt/token", { method: "POST", signal });
  if (!response.ok) return null;
  const data = (await response.json()) as Partial<SttCredentials> & { provider?: string };
  if (!data?.provider) return null;
  return data as SttCredentials;
}
