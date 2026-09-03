import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetEnvCache } from "@/lib/env";
import { __setCounterStore, createMemoryStore } from "@/counter/store";
import { pcm16ToWav } from "@/providers/stt/audio";
import { POST, decodeAudio, parseHfTranscription, requestHfTranscription } from "./route";
import { COUNTER_TOKEN_HEADER, issueCounterCapability } from "@/counter/access";

const TOKEN = "h".repeat(32);
const wav = Buffer.from(pcm16ToWav(new Uint8Array(1600).buffer)).toString("base64");

const request = (body: Record<string, unknown>, counterToken?: string) => new Request("http://localhost/api/stt/hf", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "http://localhost",
    ...(counterToken ? { [COUNTER_TOKEN_HEADER]: counterToken } : {}),
  },
  body: JSON.stringify(body),
});

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (/^(HF|SESSION|APP_ACCESS)_/.test(key)) delete process.env[key];
  }
  process.env.HF_TOKEN = TOKEN;
  __resetEnvCache();
  __setCounterStore(createMemoryStore());
});

afterEach(() => {
  vi.unstubAllGlobals();
  __setCounterStore(null);
});

describe("HF Counter STT boundary", () => {
  it("parses only a non-empty HF ASR response", () => {
    expect(parseHfTranscription({ text: "  안녕하세요  " })).toBe("안녕하세요");
    expect(parseHfTranscription({ generated_text: "wrong shape" })).toBeNull();
    expect(decodeAudio(wav)).toHaveLength(1644);
    expect(decodeAudio("not base64")).toBeNull();
  });

  it("does not call HF for a sensitive Counter profile", async () => {
    const store = createMemoryStore();
    const host = issueCounterCapability();
    const session = await store.create({
      hostLang: "ko-KR",
      hostTokenHash: host.hash,
      profileId: "refugee",
    });
    // Use the same store as the route rather than accepting a client profile.
    __setCounterStore(store);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(
      request({ audio: wav, language: "ko-KR", code: session.code }, host.token),
    );
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts a guarded general session and never exposes the HF token", async () => {
    const store = createMemoryStore();
    const host = issueCounterCapability();
    const session = await store.create({
      hostLang: "ko-KR",
      hostTokenHash: host.hash,
      profileId: "general",
    });
    __setCounterStore(store);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ text: "안녕하세요" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(
      request({ audio: wav, language: "ko-KR", code: session.code }, host.token),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ text: "안녕하세요" });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("refuses oversize request bodies before session/provider work", async () => {
    const response = await POST(new Request("http://localhost/api/stt/hf", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost", "content-length": "1100001" },
      body: "{}",
    }));
    expect(response.status).toBe(413);
  });

  it("returns a friendly provider-loading response without provider details", async () => {
    const result = await requestHfTranscription({
      token: TOKEN, model: "openai/whisper-large-v3-turbo", audio: new Uint8Array(44), language: "ko-KR",
      fetcher: async () => new Response(JSON.stringify({ error: "loading model" }), { status: 503 }),
    });
    expect(result).toMatchObject({ ok: false, status: 503 });
    if (!result.ok) expect(result.message).toMatch(/warming up/i);
  });

  it("preserves provider rate-limit retry advice", async () => {
    const result = await requestHfTranscription({
      token: TOKEN, model: "openai/whisper-large-v3-turbo", audio: new Uint8Array(44), language: "ko-KR",
      fetcher: async () => new Response("{}", { status: 429, headers: { "retry-after": "30" } }),
    });
    expect(result).toMatchObject({ ok: false, status: 429, retryAfter: "30" });
  });

  it("turns a provider timeout into a retryable, user-safe response", async () => {
    const result = await requestHfTranscription({
      token: TOKEN, model: "openai/whisper-large-v3-turbo", audio: new Uint8Array(44), language: "ko-KR",
      fetcher: async () => { throw new DOMException("aborted", "AbortError"); },
    });
    expect(result).toMatchObject({ ok: false, status: 504 });
  });
});
