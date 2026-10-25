import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as CREATE, GET as POLL, DELETE as END } from "@/app/api/remote-mic/session/route";
import { POST as CLAIM } from "@/app/api/remote-mic/claim/route";
import { POST as SIGNAL } from "@/app/api/remote-mic/signal/route";
import { SESSION_COOKIE, __resetGuards, issueSessionToken } from "@/lib/guard";
import { __resetEnvCache } from "@/lib/env";
import { FakePeerConnection, FakeStream, FakeTrack } from "@/test/fake-webrtc";
import { RemoteMicApiError, createRemoteMicApi } from "./client";
import { parsePairingFragment } from "./protocol";
import { RemoteMicReceiver } from "./receiver";
import { RemoteMicSender } from "./sender";
import { __setRemoteMicStore, createMemoryRemoteMicStore } from "./store";

/**
 * MacBook receiver ↔ iPhone sender, through the REAL signalling route
 * handlers and the REAL state machines. Only the media layer is faked (jsdom
 * has no WebRTC). Real browser-to-browser audio is verified separately by
 * `scripts/e2e-remote-mic.mjs` in Chromium.
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
  return new Response("not found", { status: 404 });
}

/** Real timers, compressed 20× so polling-driven flows finish quickly. */
const fastTimers = {
  setTimer: (fn: () => void, ms: number) => setTimeout(fn, Math.max(1, Math.round(ms / 20))),
  clearTimer: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
};

const createPeer = (config: RTCConfiguration) => new FakePeerConnection(config) as unknown as RTCPeerConnection;

async function until(predicate: () => boolean, label: string, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function setup() {
  const api = createRemoteMicApi({ fetch: routeFetch, guardedFetch: routeFetch });
  const receiver = new RemoteMicReceiver({
    api,
    origin: "https://asad.example",
    createPeerConnection: createPeer,
    attachSink: () => () => {},
    ...fastTimers,
  });
  const micTracks: FakeTrack[] = [];
  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    expect(constraints.video).toBe(false);
    const track = new FakeTrack("iPhone 마이크");
    micTracks.push(track);
    return new FakeStream([track]) as unknown as MediaStream;
  });
  const makeSender = (pairing: { id: string; secret: string } | null) =>
    new RemoteMicSender({ api, pairing, getUserMedia, createPeerConnection: createPeer, ...fastTimers });
  return { receiver, makeSender, getUserMedia, micTracks };
}

async function pairAndConnect() {
  const ctx = setup();
  await ctx.receiver.pair();
  const url = ctx.receiver.snapshot().pairingUrl!;
  expect(url.startsWith("https://asad.example/remote-mic#p=")).toBe(true);
  const sender = ctx.makeSender(parsePairingFragment(new URL(url).hash));
  await sender.start();
  await until(() => ctx.receiver.snapshot().phase === "awaiting-approval", "receiver sees the claim");
  expect(ctx.receiver.snapshot().confirmCode).toBe(sender.snapshot().confirmCode);
  await ctx.receiver.approve();
  await until(
    () => ctx.receiver.snapshot().phase === "connected" && sender.snapshot().phase === "connected",
    "both peers connected",
  );
  return { ...ctx, sender };
}

beforeEach(() => {
  vi.stubGlobal("MediaStream", FakeStream);
  vi.stubGlobal("isSecureContext", true);
  delete process.env.VERCEL;
  __resetEnvCache();
  __resetGuards();
  __setRemoteMicStore(createMemoryRemoteMicStore());
});

afterEach(() => {
  vi.unstubAllGlobals();
  __setRemoteMicStore(null);
  __resetGuards();
});

describe("remote microphone pairing and negotiation (signalling integration)", () => {
  it("Mac creates, phone joins, Mac approves, negotiation completes and ONE audio track arrives", async () => {
    const { receiver, sender, getUserMedia } = await pairAndConnect();
    const stream = receiver.currentStream();
    expect(stream).not.toBeNull();
    expect(stream!.getAudioTracks()).toHaveLength(1);
    expect(receiver.snapshot().liveTracks).toBe(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(receiver.snapshot().metrics.connectMs).not.toBeNull();
    expect(receiver.snapshot().metrics.pairingMs).not.toBeNull();
    receiver.dispose();
    sender.dispose();
  });

  it("concurrent Start taps open the microphone once", async () => {
    const ctx = setup();
    await ctx.receiver.pair();
    const sender = ctx.makeSender(parsePairingFragment(new URL(ctx.receiver.snapshot().pairingUrl!).hash));
    await Promise.all([sender.start(), sender.start(), sender.start()]);
    expect(ctx.getUserMedia).toHaveBeenCalledTimes(1);
    ctx.receiver.dispose();
    sender.dispose();
  });

  it("forwards mute state over the control channel", async () => {
    const { receiver, sender } = await pairAndConnect();
    sender.setMuted(true);
    await until(() => receiver.snapshot().sender?.muted === true, "receiver sees mute");
    sender.setMuted(false);
    await until(() => receiver.snapshot().sender?.muted === false, "receiver sees unmute");
    receiver.dispose();
    sender.dispose();
  });

  it("stop on the phone ends the incoming track; restart never duplicates it", async () => {
    const { receiver, sender, micTracks, getUserMedia } = await pairAndConnect();
    const firstStream = receiver.currentStream()!;
    const firstTrack = firstStream.getAudioTracks()[0];
    // What the live session's MicrophoneCapture listens for.
    const consumerSawEnd = vi.fn();
    firstTrack.addEventListener("ended", consumerSawEnd);

    await sender.stop();
    expect(micTracks[0].readyState).toBe("ended");
    await until(() => receiver.snapshot().phase === "paused", "receiver paused");
    expect(receiver.currentStream()).toBeNull();
    expect(firstTrack.readyState).toBe("ended");
    // track.stop() alone never fires `ended`; the receiver must tell consumers.
    expect(consumerSawEnd).toHaveBeenCalledTimes(1);

    await sender.start();
    await until(() => receiver.snapshot().phase === "connected" && !!receiver.currentStream(), "reconnected");
    const second = receiver.currentStream()!;
    expect(second).not.toBe(firstStream);
    expect(second.getAudioTracks()).toHaveLength(1);
    expect(receiver.snapshot().liveTracks).toBe(1);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(FakePeerConnection.openPeers()).toBe(2);
    receiver.dispose();
    sender.dispose();
  });

  it("recovers from an abrupt peer loss with a bounded reconnect", async () => {
    const { receiver, sender } = await pairAndConnect();
    sender.simulateNetworkDrop();
    await until(() => sender.snapshot().phase === "reconnecting", "sender reconnecting");
    await until(
      () => receiver.snapshot().phase === "connected" && sender.snapshot().phase === "connected" && !!receiver.currentStream(),
      "connection restored",
    );
    expect(receiver.snapshot().liveTracks).toBe(1);
    receiver.dispose();
    sender.dispose();
  });

  it("ending on the Mac closes both peers and releases the phone's microphone", async () => {
    const { receiver, sender, micTracks } = await pairAndConnect();
    await receiver.end();
    expect(receiver.snapshot().phase).toBe("ended");
    expect(receiver.currentStream()).toBeNull();
    await until(() => sender.snapshot().phase === "ended", "sender learns it ended");
    expect(micTracks.every((track) => track.readyState === "ended")).toBe(true);
    expect(FakePeerConnection.openPeers()).toBe(0);
    sender.dispose();
  });

  it("a rejected phone is told so and holds no microphone", async () => {
    const ctx = setup();
    await ctx.receiver.pair();
    const sender = ctx.makeSender(parsePairingFragment(new URL(ctx.receiver.snapshot().pairingUrl!).hash));
    await sender.start();
    await until(() => ctx.receiver.snapshot().phase === "awaiting-approval", "claim seen");
    await ctx.receiver.reject();
    await until(() => sender.snapshot().phase === "ended", "sender ended");
    expect(sender.snapshot().error).toBe("REJECTED");
    expect(ctx.micTracks[0].readyState).toBe("ended");
    sender.dispose();
  });

  it("a second phone with the same QR is refused and opens no peer", async () => {
    const { receiver, sender, makeSender } = await pairAndConnect();
    const intruder = makeSender(parsePairingFragment(new URL(receiver.snapshot().pairingUrl!).hash));
    await intruder.start();
    expect(intruder.snapshot()).toMatchObject({ phase: "failed", error: "ALREADY_CLAIMED", stream: null });
    expect(receiver.snapshot().liveTracks).toBe(1);
    receiver.dispose();
    sender.dispose();
    intruder.dispose();
  });

  it("reports microphone permission denial without contacting the Mac", async () => {
    const ctx = setup();
    await ctx.receiver.pair();
    const api = createRemoteMicApi({ fetch: routeFetch });
    const claim = vi.spyOn(api, "claim");
    const sender = new RemoteMicSender({
      api,
      pairing: parsePairingFragment(new URL(ctx.receiver.snapshot().pairingUrl!).hash),
      getUserMedia: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
      createPeerConnection: createPeer,
      ...fastTimers,
    });
    await sender.start();
    expect(sender.snapshot()).toMatchObject({ phase: "failed", error: "PERMISSION_DENIED" });
    expect(claim).not.toHaveBeenCalled();
    expect(ctx.receiver.snapshot().phase).toBe("waiting");
    ctx.receiver.dispose();
    sender.dispose();
  });

  it("retries a lost answer instead of stranding the phone's offer", async () => {
    const base = createRemoteMicApi({ fetch: routeFetch, guardedFetch: routeFetch });
    let failures = 0;
    const flaky = {
      ...base,
      signal: async (token: string, request: Parameters<typeof base.signal>[1]) => {
        if (request.action === "answer" && failures < 2) {
          failures += 1;
          throw new RemoteMicApiError(0, "NETWORK", "Network request failed.");
        }
        return base.signal(token, request);
      },
    };
    const receiver = new RemoteMicReceiver({
      api: flaky,
      origin: "https://asad.example",
      createPeerConnection: createPeer,
      attachSink: () => () => {},
      ...fastTimers,
    });
    const ctx = setup();
    await receiver.pair();
    const sender = ctx.makeSender(parsePairingFragment(new URL(receiver.snapshot().pairingUrl!).hash));
    await sender.start();
    await until(() => receiver.snapshot().phase === "awaiting-approval", "claim seen");
    await receiver.approve();
    await until(
      () => receiver.snapshot().phase === "connected" && sender.snapshot().phase === "connected",
      "connected despite two failed answer posts",
    );
    expect(failures).toBe(2);
    receiver.dispose();
    sender.dispose();
  });

  it("an invalid or expired link fails clearly", async () => {
    const ctx = setup();
    const invalid = ctx.makeSender(null);
    expect(invalid.snapshot()).toMatchObject({ phase: "failed", error: "INVALID_LINK" });
    const unknown = ctx.makeSender({ id: "Q".repeat(22), secret: "s".repeat(32) });
    await unknown.start();
    expect(unknown.snapshot()).toMatchObject({ phase: "failed", error: "EXPIRED" });
    expect(ctx.micTracks[0].readyState).toBe("ended");
  });
});
