import { afterEach, describe, expect, it, vi } from "vitest";
import { appendMessage, createRedisStore, resolveCounterRedisConfig } from "./store";
import type { CounterMessage } from "./types";

const message = (overrides: Partial<CounterMessage> = {}): Omit<CounterMessage, "seq"> => ({
  id: "m1",
  from: "host",
  source: "text",
  originalText: "안녕하세요",
  originalLang: "ko-KR",
  translatedText: "Hello",
  targetLang: "en-US",
  at: 0,
  status: "done",
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("counter Redis configuration", () => {
  it("accepts both native Upstash and Vercel KV-style environment names", () => {
    expect(
      resolveCounterRedisConfig({
        NODE_ENV: "test",
        UPSTASH_REDIS_REST_URL: " https://upstash.example ",
        UPSTASH_REDIS_REST_TOKEN: " token ",
      }),
    ).toEqual({ url: "https://upstash.example", token: "token", source: "upstash" });

    expect(
      resolveCounterRedisConfig({
        NODE_ENV: "test",
        KV_REST_API_URL: "https://kv.example",
        KV_REST_API_TOKEN: "kv-token",
      }),
    ).toEqual({ url: "https://kv.example", token: "kv-token", source: "vercel-kv" });
  });

  it("does not enable Redis from a half-configured credential pair", () => {
    expect(
      resolveCounterRedisConfig({ NODE_ENV: "test", UPSTASH_REDIS_REST_URL: "https://x" }),
    ).toBeNull();
    expect(
      resolveCounterRedisConfig({ NODE_ENV: "test", KV_REST_API_TOKEN: "token" }),
    ).toBeNull();
  });
});

describe("Redis counter store", () => {
  it("creates, updates, counts and deletes a shared session", async () => {
    const data = new Map<string, string>();
    let forceConflict = true;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const args = JSON.parse(String(init?.body)) as Array<string | number>;
        const command = String(args[0]).toUpperCase();
        let result: unknown;

        if (command === "SET") {
          const key = String(args[1]);
          const value = String(args[2]);
          const nx = args.some((part) => String(part).toUpperCase() === "NX");
          if (nx && data.has(key)) result = null;
          else {
            data.set(key, value);
            result = "OK";
          }
        } else if (command === "GET") {
          result = data.get(String(args[1])) ?? null;
        } else if (command === "EVAL") {
          const key = String(args[3]);
          const expectedRev = Number(args[4]);
          const nextRaw = String(args[5]);
          const currentRaw = data.get(key);
          if (!currentRaw) result = 0;
          else {
            const current = JSON.parse(currentRaw) as { rev: number; session: unknown };
            if (forceConflict) {
              forceConflict = false;
              data.set(key, JSON.stringify({ rev: current.rev + 1, session: current.session }));
              result = -1;
            } else if (current.rev !== expectedRev) result = -1;
            else {
              data.set(key, nextRaw);
              result = 1;
            }
          }
        } else if (command === "DEL") {
          result = data.delete(String(args[1])) ? 1 : 0;
        } else if (command === "SCAN") {
          result = ["0", [...data.keys()]];
        } else {
          throw new Error(`Unexpected Redis command: ${command}`);
        }

        return new Response(JSON.stringify({ result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const store = createRedisStore({
      url: "https://redis.example",
      token: "secret",
      source: "upstash",
    });

    const session = await store.create({ hostLang: "ko-KR" });
    expect((await store.get(session.code))?.state).toBe("waiting");

    const updated = await store.update(session.code, (current) => {
      current.state = "active";
      current.guestLang = "en-US";
      appendMessage(current, message());
    });

    expect(updated?.messages).toHaveLength(1);
    expect(updated?.messages[0].seq).toBe(1);
    expect(await store.stats()).toEqual({ active: 1, waiting: 0, totalMessages: 1 });
    expect(await store.end(session.code)).toBe(true);
    expect(await store.get(session.code)).toBeUndefined();
  });
});
