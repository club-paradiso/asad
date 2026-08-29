import { beforeEach, describe, expect, it } from "vitest";
import { __resetEnvCache } from "@/lib/env";
import { POST } from "./route";

const ACCOUNT_KEY = "d".repeat(40);
const request = (usage: "live" | "counter", language = "vi-VN") =>
  new Request("http://localhost/api/stt/token", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ usage, language }),
  });

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (/^(STT|DEEPGRAM|OPENAI|SESSION|APP_ACCESS)_/.test(key)) delete process.env[key];
  }
  process.env.STT_PROVIDER = "deepgram";
  process.env.DEEPGRAM_API_KEY = ACCOUNT_KEY;
  delete process.env.DEEPGRAM_PROJECT_ID;
  __resetEnvCache();
});

describe("POST /api/stt/token — Counter credential boundary", () => {
  it("never exposes a long-lived account key to Counter Mode", async () => {
    const body = await (await POST(request("counter"))).json();
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
