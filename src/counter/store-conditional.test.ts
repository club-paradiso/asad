import { afterEach, describe, expect, it, vi } from "vitest";
import { appendMessage, createMemoryStore, createRedisStore } from "./store";

/**
 * A mutation that returns `false` is a read, not a write.
 *
 * The message route reads, authorises and classifies every turn in one store
 * call; most turns change nothing about the session until the translation is
 * persisted. Those must not pay for a compare-and-set.
 */
describe("conditional store mutations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("memory: a declined mutation leaves the session untouched and unrefreshed", () => {
    let now = 1_000;
    const store = createMemoryStore(() => now);
    const created = store.create({ hostLang: "ko-KR", hostTokenHash: "h" });

    now = 5_000;
    const read = store.update(created.code, (session) => {
      session.guestLang = "en-US"; // scribbled on the copy, then declined
      return false;
    });
    expect(read?.guestLang).toBeNull();
    expect(read?.lastActivityAt).toBe(1_000);
    expect(store.get(created.code)?.guestLang).toBeNull();

    const written = store.update(created.code, (session) => {
      session.guestLang = "en-US";
    });
    expect(written?.guestLang).toBe("en-US");
    expect(written?.lastActivityAt).toBe(5_000);
  });

  it("redis: a declined mutation costs one GET and no EVAL", async () => {
    const data = new Map<string, string>();
    const commands: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const args = JSON.parse(String(init?.body)) as Array<string | number>;
        const command = String(args[0]).toUpperCase();
        commands.push(command);
        let result: unknown;
        if (command === "SET") {
          data.set(String(args[1]), String(args[2]));
          result = "OK";
        } else if (command === "GET") {
          result = data.get(String(args[1])) ?? null;
        } else if (command === "EVAL") {
          const key = String(args[3]);
          const current = JSON.parse(data.get(key)!) as { rev: number };
          if (current.rev !== Number(args[4])) result = -1;
          else {
            data.set(key, String(args[5]));
            result = 1;
          }
        } else {
          throw new Error(`Unexpected Redis command: ${command}`);
        }
        return new Response(JSON.stringify({ result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const store = createRedisStore({ url: "https://redis.example", token: "t", source: "upstash" });
    const created = await store.create({ hostLang: "ko-KR", hostTokenHash: "h" });
    commands.length = 0;

    const read = await store.update(created.code, () => false);
    expect(read?.code).toBe(created.code);
    expect(commands).toEqual(["GET"]);

    commands.length = 0;
    const written = await store.update(created.code, (session) => {
      appendMessage(session, {
        id: "m1",
        from: "host",
        source: "text",
        originalText: "안녕하세요",
        originalLang: "ko-KR",
        translatedText: "Hello",
        targetLang: "en-US",
        at: 0,
        status: "done",
      });
    });
    expect(written?.messages).toHaveLength(1);
    expect(commands).toEqual(["GET", "EVAL"]);
  });
});
