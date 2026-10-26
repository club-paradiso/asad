import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as CREATE, GET as POLL, DELETE as END } from "@/app/api/remote-mic/session/route";
import { POST as CLAIM } from "@/app/api/remote-mic/claim/route";
import { POST as SIGNAL } from "@/app/api/remote-mic/signal/route";
import { GET as RELAY_READ, POST as RELAY_POST } from "@/app/api/remote-mic/relay/route";
import { SESSION_COOKIE, __resetGuards, issueSessionToken } from "@/lib/guard";
import { __resetEnvCache } from "@/lib/env";
import { FakePeerConnection, FakeStream, FakeTrack } from "@/test/fake-webrtc";
import { createRemoteMicApi } from "./client";
import { RELAY_FRAME_BYTES, REMOTE_MIC_TOKEN_HEADER, parsePairingFragment } from "./protocol";
import { RemoteMicReceiver } from "./receiver";
import { RemoteMicSender } from "./sender";
import { __setRemoteMicStore, createMemoryRemoteMicStore } from "./store";
import type { RelayCapture, RelayPlayout, RelayPlayoutSink } from "./relay-audio";

/**
 * Phone ↔ computer through the SERVER RELAY: the real route handlers, the
 * real state machines and the real relay store; only Web Audio and WebRTC are
 * faked. Proves the fallback engages without a shared network, that audio
 * frames arrive in order as ONE live track, and that stop / reconnect / end
 * behave as on the direct path.
 */

const ORIGIN = "http://localhost";

async function routeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input, ORIGIN);
  const headers = new Headers(init.headers);
  headers.set("origin", ORIGIN);
  headers.set("cookie", `${SESSION_COOKIE}=${issueSessionToken()}`);
  const request = new Request(url, { ...init, headers });
  const method = (init.method ?? "GET").toUpperCase();
  if (url.pathname === "/api/remote-mic/session") {
    if (method === "POST") return CREATE(request);
    if (method === "DELETE") return END(request);
    return POLL(request);
  }
  if (url.pathname === "/api/remote-mic/claim") return CLAIM(request);
  if (url.pathname === "/api/remote-mic/signal") return SIGNAL(request);
  if (url.pathname === "/api/remote-mic/relay") return method === "POST" ? RELAY_POST(request) : RELAY_READ(request);
  return new Response("not found", { status: 404 });
}

const fastTimers = {
  setTimer: (fn: () => void, ms: number) => setTimeout(fn, Math.max(1, Math.round(ms / 20))),
  clearTimer: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
};

async function until(predicate: () => boolean, label: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** A capture whose frames the test emits by hand: frame k is filled with byte k. */
class FakeCapture implements RelayCapture {
  emit: ((frame: Uint8Array) => void) | null = null;
  starts = 0;
  closed = false;
  private counter = 0;
  start(_stream: MediaStream, onFrame: (frame: Uint8Array) => void) {
    this.starts += 1;
    this.emit = onFrame;
  }
  stop() {
    this.emit = null;
  }
  close() {
    this.closed = true;
    this.emit = null;
  }
  frame() {
    const value = this.counter % 256;
    this.counter += 1;
    this.emit?.(new Uint8Array(RELAY_FRAME_BYTES).fill(value));
  }
}

class FakeSink implements RelayPlayoutSink {
  readonly track = new FakeTrack("relay");
  readonly stream = new FakeStream([this.track]) as unknown as MediaStream;
  readonly pushed: Float32Array[] = [];
  closed = false;
  push(samples: Float32Array) {
    this.pushed.push(samples);
  }
  bufferedMs() {
    return 300;
  }
  close() {
    this.closed = true;
  }
}

class FakePlayout implements RelayPlayout {
  readonly sinks: FakeSink[] = [];
  open() {
    const sink = new FakeSink();
    this.sinks.push(sink);
    return sink;
  }
  close() {}
}

/** A WebRTC peer whose network never connects: no shared Wi-Fi, no TURN. */
class UnreachablePeer extends FakePeerConnection {
  async setRemoteDescription() {
    // Descriptions "apply", but no candidate pair ever succeeds.
  }
}

function setup(options: { unreachable?: boolean } = {}) {
  const api = createRemoteMicApi({ fetch: routeFetch, guardedFetch: routeFetch });
  const playout = new FakePlayout();
  const createPeer = (config: RTCConfiguration) =>
    (options.unreachable ? new UnreachablePeer(config) : new FakePeerConnection(config)) as unknown as RTCPeerConnection;
  const receiver = new RemoteMicReceiver({
    api,
    origin: "https://asad.example",
    createPeerConnection: createPeer,
    attachSink: () => () => {},
    createRelayPlayout: () => playout,
    ...fastTimers,
  });
  const capture = new FakeCapture();
  const getUserMedia = vi.fn(async () => new FakeStream([new FakeTrack("Android 마이크")]) as unknown as MediaStream);
  const makeSender = (pairing: { id: string; secret: string } | null) =>
    new RemoteMicSender({
      api,
      pairing,
      getUserMedia,
      createPeerConnection: createPeer,
      createRelayCapture: () => capture,
      relayFallbackMs: 4000,
      ...fastTimers,
    });
  return { api, receiver, makeSender, capture, playout };
}

async function pairToApproval(ctx: ReturnType<typeof setup>) {
  await ctx.receiver.pair();
  const url = ctx.receiver.snapshot().pairingUrl!;
  const sender = ctx.makeSender(parsePairingFragment(new URL(url).hash));
  await sender.start();
  await until(() => ctx.receiver.snapshot().phase === "awaiting-approval", "receiver sees the claim");
  await ctx.receiver.approve();
  return sender;
}

beforeEach(() => {
  vi.stubGlobal("MediaStream", FakeStream);
  vi.stubGlobal("isSecureContext", true);
  delete process.env.VERCEL;
  delete process.env.REMOTE_MIC_TRANSPORT;
  __resetEnvCache();
  __resetGuards();
  __setRemoteMicStore(createMemoryRemoteMicStore());
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.REMOTE_MIC_TRANSPORT;
  __setRemoteMicStore(null);
  __resetGuards();
});

describe("remote microphone server relay (no shared network)", () => {
  it("falls back to the relay when WebRTC never connects, and audio arrives as ONE live track", async () => {
    const ctx = setup({ unreachable: true });
    const sender = await pairToApproval(ctx);

    await until(() => sender.snapshot().transport === "relay" && ctx.capture.emit !== null, "sender engages the relay");
    for (let i = 0; i < 4; i += 1) ctx.capture.frame();

    await until(() => ctx.receiver.snapshot().phase === "connected", "receiver connected via relay");
    await until(() => (ctx.playout.sinks[0]?.pushed.length ?? 0) >= 4, "four frames played out");
    const state = ctx.receiver.snapshot();
    expect(state.transport).toBe("relay");
    expect(state.liveTracks).toBe(1);
    expect(ctx.receiver.currentStream()?.getAudioTracks()).toHaveLength(1);
    expect(sender.snapshot().phase).toBe("connected");
    expect(FakePeerConnection.openPeers()).toBe(0);

    // Frames decode back to what was sent: frame k is µ-law byte k.
    const sink = ctx.playout.sinks[0];
    expect(sink.pushed[0]).toHaveLength(RELAY_FRAME_BYTES);
    expect(sink.pushed[1][0]).not.toBe(sink.pushed[2][0]);
    await until(() => ctx.receiver.snapshot().stats.packetsReceived >= 4, "relay stats counted");
    expect(ctx.receiver.snapshot().stats.packetsLost).toBe(0);
    expect(ctx.receiver.snapshot().stats.bytesReceived).toBe(4 * RELAY_FRAME_BYTES);

    ctx.receiver.dispose();
    sender.dispose();
  });

  it("uses the relay straight away when the deployment forces it", async () => {
    process.env.REMOTE_MIC_TRANSPORT = "relay";
    const ctx = setup();
    const sender = await pairToApproval(ctx);
    await until(() => ctx.capture.emit !== null, "relay capture started without trying WebRTC");
    expect(FakePeerConnection.openPeers()).toBe(0);
    ctx.capture.frame();
    await until(() => ctx.receiver.snapshot().phase === "connected", "connected");
    expect(ctx.receiver.snapshot().transport).toBe("relay");
    ctx.receiver.dispose();
    sender.dispose();
  });

  it("prefers direct WebRTC when it connects: the relay never starts", async () => {
    const ctx = setup();
    const sender = await pairToApproval(ctx);
    await until(() => ctx.receiver.snapshot().phase === "connected" && sender.snapshot().phase === "connected", "direct");
    await new Promise((resolve) => setTimeout(resolve, 400)); // past the (compressed) fallback budget
    expect(sender.snapshot().transport).toBe("direct");
    expect(ctx.receiver.snapshot().transport).toBe("direct");
    expect(ctx.capture.starts).toBe(0);
    ctx.receiver.dispose();
    sender.dispose();
  });

  it("stop pauses (the track ends), start resumes on a NEW track, and only one is ever live", { timeout: 20_000 }, async () => {
    const ctx = setup({ unreachable: true });
    const sender = await pairToApproval(ctx);
    await until(() => ctx.capture.emit !== null, "relay engaged");
    ctx.capture.frame();
    await until(() => ctx.receiver.snapshot().phase === "connected", "connected");
    const firstTrack = ctx.playout.sinks[0].track;

    await sender.stop();
    await until(() => ctx.receiver.snapshot().phase === "paused", "receiver paused", 8000);
    expect(ctx.receiver.snapshot().liveTracks).toBe(0);
    expect(firstTrack.readyState).toBe("ended");
    expect(ctx.playout.sinks[0].closed).toBe(true);

    await sender.start();
    await until(() => ctx.capture.emit !== null, "capture restarted");
    ctx.capture.frame();
    await until(() => ctx.receiver.snapshot().phase === "connected" && ctx.playout.sinks.length === 2, "resumed");
    expect(ctx.receiver.snapshot().liveTracks).toBe(1);

    ctx.receiver.dispose();
    sender.dispose();
  });

  it("counts dropped frames as loss", async () => {
    const ctx = setup({ unreachable: true });
    const sender = await pairToApproval(ctx);
    await until(() => ctx.capture.emit !== null, "relay engaged");
    ctx.capture.frame();
    await until(() => ctx.receiver.snapshot().stats.packetsReceived === 1, "first frame");
    // Simulate two frames lost on the phone side by advancing the counter.
    (sender as unknown as { frameCounter: number }).frameCounter += 2;
    ctx.capture.frame();
    await until(() => ctx.receiver.snapshot().stats.packetsReceived === 2, "second frame");
    expect(ctx.receiver.snapshot().stats.packetsLost).toBe(2);
    ctx.receiver.dispose();
    sender.dispose();
  });

  it("ending the pairing stops the relay on both sides and deletes buffered audio", async () => {
    const ctx = setup({ unreachable: true });
    const sender = await pairToApproval(ctx);
    await until(() => ctx.capture.emit !== null, "relay engaged");
    ctx.capture.frame();
    await until(() => ctx.receiver.snapshot().phase === "connected", "connected");
    await ctx.receiver.end();
    await until(() => sender.snapshot().phase === "ended", "phone sees the end", 8000);
    expect(ctx.capture.closed).toBe(true);
    expect(ctx.receiver.snapshot().liveTracks).toBe(0);
    sender.dispose();
  });
});

describe("relay route authorisation", () => {
  async function relayPairing() {
    process.env.REMOTE_MIC_TRANSPORT = "relay";
    const ctx = setup();
    const created = await ctx.api.create();
    const url = new URL(`https://x/remote-mic#p=${created.id}.${created.pairingSecret}`);
    const claimed = await ctx.api.claim(created.id, parsePairingFragment(url.hash)!.secret);
    await ctx.api.signal(created.receiverToken, { action: "approve", id: created.id });
    return { ...ctx, created, claimed };
  }

  const post = (token: string, body: unknown) =>
    routeFetch("/api/remote-mic/relay", {
      method: "POST",
      headers: { "content-type": "application/json", [REMOTE_MIC_TOKEN_HEADER]: token },
      body: JSON.stringify(body),
    });
  const read = (token: string, id: string, after = "") =>
    routeFetch(`/api/remote-mic/relay?id=${id}&after=${after}`, { headers: { [REMOTE_MIC_TOKEN_HEADER]: token } });

  it("refuses writes before the phone switches to relay, and from anyone but the phone", async () => {
    const { created, claimed } = await relayPairing();
    const frame = { id: created.id, frames: [{ n: 0, a: "AAAA" }] };
    expect((await post(claimed.senderToken, frame)).status).toBe(409);
    await routeFetch("/api/remote-mic/signal", {
      method: "POST",
      headers: { "content-type": "application/json", [REMOTE_MIC_TOKEN_HEADER]: claimed.senderToken },
      body: JSON.stringify({ action: "transport", id: created.id, mode: "relay" }),
    });
    expect((await post(created.receiverToken, frame)).status).toBe(401);
    expect((await post("not-a-token", frame)).status).toBe(401);
    expect((await post(claimed.senderToken, frame)).status).toBe(200);

    // Only the computer reads.
    expect((await read(claimed.senderToken, created.id)).status).toBe(401);
    const ok = await read(created.receiverToken, created.id);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { frames: Array<{ n: number; a: string }>; cursor: string };
    expect(body.frames).toEqual([expect.objectContaining({ n: 0, a: "AAAA" })]);
    const again = (await (await read(created.receiverToken, created.id, body.cursor)).json()) as { frames: unknown[] };
    expect(again.frames).toEqual([]);
  });

  it("rejects malformed frames and cursors", async () => {
    const { created, claimed } = await relayPairing();
    expect((await post(claimed.senderToken, { id: created.id, frames: [{ n: 0, a: "not base64!" }] })).status).toBe(400);
    expect((await post(claimed.senderToken, { id: created.id, frames: [] })).status).toBe(400);
    expect((await read(created.receiverToken, created.id, "drop table")).status).toBe(400);
  });

  it("only the phone may switch the transport", async () => {
    const { created } = await relayPairing();
    const response = await routeFetch("/api/remote-mic/signal", {
      method: "POST",
      headers: { "content-type": "application/json", [REMOTE_MIC_TOKEN_HEADER]: created.receiverToken },
      body: JSON.stringify({ action: "transport", id: created.id, mode: "relay" }),
    });
    expect(response.status).toBe(403);
  });
});
