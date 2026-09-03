/** Browser client for the server-owned Hugging Face Counter fallback. */
import { pcm16ToWav } from "./audio";
import { guardedFetch } from "@/lib/session-client";
import { COUNTER_TOKEN_HEADER } from "@/counter/access-shared";

const REQUEST_TIMEOUT_MS = 42_000; // allows a cold model start without hanging forever

export interface HfTranscriptionRequest {
  pcm16: ArrayBuffer;
  language: string;
  /** A Counter session code lets the server enforce its profile policy. */
  code?: string;
  counterToken?: string;
}

export class HfTranscriptionError extends Error {
  constructor(readonly status: number, message = "Voice transcription is unavailable.") {
    super(message);
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Avoid spreading a ~1 MB array into String.fromCharCode, which exceeds the
  // argument limit on some mobile browsers.
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function transcribeWithHuggingFace(input: HfTranscriptionRequest): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await guardedFetch("/api/stt/hf", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.counterToken ? { [COUNTER_TOKEN_HEADER]: input.counterToken } : {}),
      },
      body: JSON.stringify({
        audio: arrayBufferToBase64(pcm16ToWav(input.pcm16)),
        language: input.language,
        code: input.code,
      }),
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
    if (!response.ok || typeof data.text !== "string") {
      throw new HfTranscriptionError(
        response.status || 503,
        typeof data.error === "string" ? data.error : undefined,
      );
    }
    return data.text.trim();
  } catch (error) {
    if (error instanceof HfTranscriptionError) throw error;
    throw new HfTranscriptionError(504);
  } finally {
    clearTimeout(timer);
  }
}
