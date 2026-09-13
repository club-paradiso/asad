import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetEnvCache } from "@/lib/env";
import { POST } from "./route";
import { COUNTER_TOKEN_HEADER, issueCounterCapability } from "@/counter/access";
import { __setCounterStore, createMemoryStore } from "@/counter/store";

const ACCOUNT_KEY = "d".repeat(40);
const request = (
  usage: "live" | "counter",
  language = "vi-VN",
  counter?: { code: string; token: string },
) =>
  new Request("http://localhost/api/stt/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...(counter ? { [COUNTER_TOKEN_HEADER]: counter.token } : {}),
    },
    body: JSON.stringify({ usage, language, code: counter?.code }),
  });

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (/^(STT|DEEPGRAM|OPENAI|SESSION|APP_ACCESS)_/.test(key)) delete process.env[key];
  }
  process.env.STT_PROVIDER = "deepgram";
  process.env.DEEPGRAM_API_KEY = ACCOUNT_KEY;
  delete process.env.DEEPGRAM_PROJECT_ID;
  __resetEnvCache();
  __setCounterStore(null);
});

afterEach(() => {
  __setCounterStore(null);
  vi.unstubAllGlobals();
});

describe("POST /api/stt/token — Counter credential boundary", () => {
  it("never exposes a long-lived account key to Counter Mode", async () => {
    const store = createMemoryStore();
    const host = issueCounterCapability();
    const session = await store.create({ hostLang: "ko-KR", hostTokenHash: host.hash });
    __setCounterStore(store);
    const body = await (
      await POST(request("counter", "vi-VN", { code: session.code, token: host.token }))
    ).json();
    expect(body.provider).toBe("demo");
    expect(JSON.stringify(body)).not.toContain(ACCOUNT_KEY);
  });

  it("preserves the existing Live fallback while Counter is hardened", async () => {
    const body = await (await POST(request("live"))).json();
    expect(body.provider).toBe("deepgram");
    expect(body.token).toBe(ACCOUNT_KEY);
    expect(body.ephemeral).toBe(false);
  });
});

describe("POST /api/stt/token — OpenAI session language", () => {
  const OPENAI_KEY = "sk-" + "o".repeat(40);

  const openaiRequests = () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ client_secret: { value: "ephemeral-secret" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  };

  const transcriptionSentTo = (fetcher: ReturnType<typeof vi.fn>) => {
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/realtime/transcription_sessions");
    return JSON.parse(String(init.body)).input_audio_transcription as {
      model: string;
      language?: string;
      prompt?: string;
    };
  };

  beforeEach(() => {
    process.env.STT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = OPENAI_KEY;
    delete process.env.DEEPGRAM_API_KEY;
    __resetEnvCache();
  });

  it("mints a zh-TW session with the Whisper code and the Traditional prompt", async () => {
    const fetcher = openaiRequests();
    const body = await (await POST(request("live", "zh-TW"))).json();

    expect(body).toMatchObject({ provider: "openai", token: "ephemeral-secret" });
    expect(transcriptionSentTo(fetcher)).toEqual({
      model: "gpt-live-transcribe",
      language: "zh",
      prompt: "以下是國語的繁體中文轉寫。",
    });
  });

  it("canonicalises a browser's Chinese tag before choosing the script prompt", async () => {
    const fetcher = openaiRequests();
    await POST(request("live", "zh-Hant-HK"));
    expect(transcriptionSentTo(fetcher).prompt).toBe("以下是國語的繁體中文轉寫。");

    vi.unstubAllGlobals();
    const simplified = openaiRequests();
    await POST(request("live", "zh-Hans-SG"));
    expect(transcriptionSentTo(simplified)).toMatchObject({
      language: "zh",
      prompt: "以下是普通话的简体中文转写。",
    });
  });

  it("sends the registry base code for a regional tag and no prompt where none is defined", async () => {
    const fetcher = openaiRequests();
    await POST(request("live", "pt-BR"));
    expect(transcriptionSentTo(fetcher)).toEqual({ model: "gpt-live-transcribe", language: "pt" });
  });

  it("falls back to Korean for a tag the registry does not know", async () => {
    const fetcher = openaiRequests();
    await POST(request("live", "xx-XX"));
    expect(transcriptionSentTo(fetcher)).toEqual({ model: "gpt-live-transcribe", language: "ko" });
  });
});
