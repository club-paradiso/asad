import { describe, expect, it, vi } from "vitest";
import { createMemoryRemoteMicStore, createRedisRemoteMicStore } from "./store";
import { newPairing } from "./session";
import { PAIRING_WINDOW_MS } from "./protocol";

const T0 = 1_800_000_000_000;

describe("memory remote microphone store", () => {
  it("creates, reads, updates conditionally and sweeps expired pairings", async () => {
    let now = T0;
    const store = createMemoryRemoteMicStore(() => now);
    const { record } = newPairing(T0);
    await store.create(record);
    expect((await store.get(record.id))?.state).toBe("waiting");

    const skipped = await store.update(record.id, (draft) => {
      draft.state = "ended";
      return { write: false, result: "no" };
    });
    expect(skipped).toEqual({ found: true, result: "no" });
    expect((await store.get(record.id))?.state).toBe("waiting");

    now = T0 + PAIRING_WINDOW_MS + 1;
    expect(await store.get(record.id)).toBeUndefined();
    expect(await store.update(record.id, () => ({ write: true, result: 1 }))).toEqual({ found: false });
  });

  it("returns copies, so callers cannot mutate stored state by accident", async () => {
    const store = createMemoryRemoteMicStore(() => T0);
    const { record } = newPairing(T0);
    await store.create(record);
    const copy = await store.get(record.id);
    copy!.state = "ended";
    expect((await store.get(record.id))?.state).toBe("waiting");
  });
});

describe("Redis remote microphone store", () => {
  const config = { url: "https://redis.example", token: "redis-token", source: "upstash" as const };

  it("uses SET NX with a TTL and a compare-and-set that retries a lost race", async () => {
    const { record } = newPairing(T0);
    let stored = "";
    let casCalls = 0;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const args = JSON.parse(String(init?.body)) as Array<string | number>;
      const reply = (result: unknown) => new Response(JSON.stringify({ result }), { status: 200 });
      switch (args[0]) {
        case "SET":
          expect(args).toContain("NX");
          expect(args).toContain("PX");
          stored = String(args[2]);
          return reply("OK");
        case "GET":
          return reply(stored || null);
        case "EVAL": {
          casCalls += 1;
          if (casCalls === 1) return reply(-1); // another writer won
          stored = String(args[5]);
          return reply(1);
        }
        default:
          return reply(null);
      }
    });
    const store = createRedisRemoteMicStore(config, () => T0, fetchImpl as unknown as typeof fetch);
    await store.create(record);
    const outcome = await store.update(record.id, (draft) => {
      draft.state = "claimed";
      return { write: true, result: "ok" };
    });
    expect(outcome).toEqual({ found: true, result: "ok" });
    expect(casCalls).toBe(2);
    expect(JSON.parse(stored).record.state).toBe("claimed");
    // The bearer token goes in a header, never into a key or a body.
    for (const call of fetchImpl.mock.calls) expect(String(call[1]?.body)).not.toContain("redis-token");
  });

  it("does not leak the store's own error text", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "ERR sdp=v=0 secret" }), { status: 200 }));
    const store = createRedisRemoteMicStore(config, () => T0, fetchImpl as unknown as typeof fetch);
    await expect(store.get("x".repeat(22))).rejects.toThrow("Remote microphone store returned an error.");
  });
});
