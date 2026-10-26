/**
 * The relay's Lua scripts against a REAL Redis server, through an
 * Upstash-style REST shim. Skipped when no `redis-server` binary exists.
 * The unit tests elsewhere mock fetch; only this proves the scripts parse,
 * check tokens and state, trim and expire as intended.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyClaim, applySignal, newPairing } from "./session";
import { RELAY_MAX_STORED_FRAMES } from "./protocol";
import { createRedisRemoteMicStore } from "./store";

const available = spawnSync("redis-server", ["--version"]).status === 0;
const PORT = 20_000 + Math.floor(Math.random() * 20_000);
let server: ChildProcess | null = null;

/* --- A minimal RESP client: one connection per command, enough for tests --- */
function encode(args: Array<string | number>): string {
  return `*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`).join("")}`;
}

function parse(buffer: Buffer, offset = 0): [unknown, number] | null {
  const end = buffer.indexOf("\r\n", offset);
  if (end < 0) return null;
  const type = String.fromCharCode(buffer[offset]);
  const line = buffer.toString("utf8", offset + 1, end);
  const next = end + 2;
  if (type === "+") return [line, next];
  if (type === "-") return [{ error: line }, next];
  if (type === ":") return [Number(line), next];
  if (type === "$") {
    const length = Number(line);
    if (length < 0) return [null, next];
    if (buffer.length < next + length + 2) return null;
    return [buffer.toString("utf8", next, next + length), next + length + 2];
  }
  if (type === "*") {
    const count = Number(line);
    if (count < 0) return [null, next];
    const items: unknown[] = [];
    let position = next;
    for (let i = 0; i < count; i += 1) {
      const parsed = parse(buffer, position);
      if (!parsed) return null;
      items.push(parsed[0]);
      position = parsed[1];
    }
    return [items, position];
  }
  throw new Error(`Unknown RESP type ${type}`);
}

function command(args: Array<string | number>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(PORT, "127.0.0.1");
    let data = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, Buffer.from(chunk)]);
      const parsed = parse(data);
      if (parsed) {
        socket.end();
        resolve(parsed[0]);
      }
    });
    socket.on("error", reject);
    socket.write(encode(args));
  });
}

/** Upstash REST semantics: POST a JSON command array, get {result} or {error}. */
const restFetch = (async (_url: string, init: RequestInit) => {
  const args = JSON.parse(String(init.body)) as Array<string | number>;
  const result = await command(args);
  const body =
    result && typeof result === "object" && "error" in (result as object) ? { error: (result as { error: string }).error } : { result };
  return new Response(JSON.stringify(body), { status: 200 });
}) as unknown as typeof fetch;

beforeAll(async () => {
  if (!available) return;
  server = spawn("redis-server", ["--port", String(PORT), "--save", "", "--appendonly", "no"], { stdio: "ignore" });
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await command(["PING"])) === "PONG") return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("redis-server did not start");
});

afterAll(() => {
  server?.kill();
});

describe.skipIf(!available)("Redis relay scripts (real redis-server)", () => {
  const config = { url: "http://redis.local", token: "t", source: "upstash" as const };

  async function approvedPairing() {
    const store = createRedisRemoteMicStore(config, Date.now, restFetch);
    const now = Date.now();
    const { record, receiverToken, pairingSecret } = newPairing(now);
    const claim = applyClaim(record, pairingSecret, now);
    if (!claim.ok) throw new Error("claim failed");
    applySignal(record, "receiver", { action: "approve", id: record.id }, now);
    await store.create(record);
    return { store, id: record.id, receiverToken, senderToken: claim.value.senderToken };
  }

  async function setRelay(store: ReturnType<typeof createRedisRemoteMicStore>, id: string, mode: "relay" | "direct") {
    await store.update(id, (draft) => {
      const result = applySignal(draft, "sender", { action: "transport", id, mode }, Date.now());
      return { write: result.ok, result };
    });
  }

  it("enforces role tokens and relay state atomically, and reads strictly after the cursor", async () => {
    const { store, id, receiverToken, senderToken } = await approvedPairing();
    expect(await store.relayAppend(id, senderToken, [{ n: 0, a: "AAAA" }])).toBe("not-relay");
    await setRelay(store, id, "relay");
    expect(await store.relayAppend(id, receiverToken, [{ n: 0, a: "AAAA" }])).toBe("unauthorized");
    expect(await store.relayAppend("A".repeat(22), senderToken, [{ n: 0, a: "AAAA" }])).toBe("not-found");
    expect(await store.relayAppend(id, senderToken, [{ n: 0, a: "AAAA" }, { n: 1, a: "BBBB" }])).toBe("ok");

    expect(await store.relayRead(id, senderToken, "", 20)).toEqual({ kind: "unauthorized" });
    const first = await store.relayRead(id, receiverToken, "", 20);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    expect(first.frames.map((f) => [f.n, f.a])).toEqual([
      [0, "AAAA"],
      [1, "BBBB"],
    ]);
    const after = await store.relayRead(id, receiverToken, first.frames[0].id, 20);
    expect(after.kind === "ok" && after.frames.map((f) => f.n)).toEqual([1]);
    const none = await store.relayRead(id, receiverToken, first.frames[1].id, 20);
    expect(none.kind === "ok" && none.frames).toEqual([]);

    // Count is honoured even though XRANGE's start is inclusive.
    const one = await store.relayRead(id, receiverToken, "", 1);
    expect(one.kind === "ok" && one.frames.map((f) => f.n)).toEqual([0]);
  });

  it("bounds stored audio, expires it, and deletes it with the pairing", async () => {
    const { store, id, receiverToken, senderToken } = await approvedPairing();
    await setRelay(store, id, "relay");
    for (let batch = 0; batch < 12; batch += 1) {
      const frames = Array.from({ length: 10 }, (_, i) => ({ n: batch * 10 + i, a: "AAAA" }));
      expect(await store.relayAppend(id, senderToken, frames)).toBe("ok");
    }
    const length = (await command(["XLEN", `asad:remote-mic:v1:relay:${id}`])) as number;
    expect(length).toBe(RELAY_MAX_STORED_FRAMES);
    const kept = await store.relayRead(id, receiverToken, "", 100);
    // The NEWEST audio is kept.
    expect(kept.kind === "ok" && kept.frames.at(-1)?.n).toBe(119);
    const ttl = (await command(["PTTL", `asad:remote-mic:v1:relay:${id}`])) as number;
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);

    // Switching back to direct closes the relay for both roles.
    await setRelay(store, id, "direct");
    expect(await store.relayRead(id, receiverToken, "", 20)).toEqual({ kind: "not-relay" });

    await store.delete(id);
    expect(await command(["EXISTS", `asad:remote-mic:v1:relay:${id}`])).toBe(0);
  });
});
