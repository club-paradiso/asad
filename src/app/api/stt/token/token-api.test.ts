import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

afterEach(() => __setCounterStore(null));

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
