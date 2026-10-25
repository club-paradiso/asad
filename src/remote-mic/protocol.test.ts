import { describe, expect, it } from "vitest";
import { pairingUrl, parsePairingFragment, signalSchema } from "./protocol";

const ID = "A".repeat(22);
const SECRET = "b".repeat(32);

describe("pairing link", () => {
  it("puts the credential in the fragment, never the path or query", () => {
    const url = new URL(pairingUrl("https://asad.example/", ID, SECRET));
    expect(url.pathname).toBe("/remote-mic");
    expect(url.search).toBe("");
    expect(url.hash).toBe(`#p=${ID}.${SECRET}`);
  });

  it("parses a valid fragment and rejects malformed ones", () => {
    expect(parsePairingFragment(`#p=${ID}.${SECRET}`)).toEqual({ id: ID, secret: SECRET });
    expect(parsePairingFragment("")).toBeNull();
    expect(parsePairingFragment(`#p=${ID}`)).toBeNull();
    expect(parsePairingFragment(`#p=${ID}.${SECRET}.extra`)).toBeNull();
    expect(parsePairingFragment(`#p=${ID}.short`)).toBeNull();
    expect(parsePairingFragment(`#p=../../etc.${SECRET}`)).toBeNull();
  });
});

describe("signal validation", () => {
  const base = { id: ID, generation: 1, peerId: "peer-aaaaaaaa" };

  it("accepts an audio-only offer", () => {
    const parsed = signalSchema.safeParse({ ...base, action: "offer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" });
    expect(parsed.success).toBe(true);
  });

  it("refuses any SDP that asks for video", () => {
    const parsed = signalSchema.safeParse({
      ...base,
      action: "offer",
      sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses non-SDP, oversized SDP, unknown actions and extra fields", () => {
    expect(signalSchema.safeParse({ ...base, action: "offer", sdp: "hello world" }).success).toBe(false);
    expect(signalSchema.safeParse({ ...base, action: "offer", sdp: `v=0\r\n${"a".repeat(20_000)}` }).success).toBe(false);
    expect(signalSchema.safeParse({ id: ID, action: "launch" }).success).toBe(false);
    expect(signalSchema.safeParse({ id: ID, action: "approve", admin: true }).success).toBe(false);
  });

  it("bounds candidate batches", () => {
    const candidate = { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 };
    expect(signalSchema.safeParse({ id: ID, action: "candidates", generation: 1, candidates: [candidate] }).success).toBe(true);
    expect(
      signalSchema.safeParse({ id: ID, action: "candidates", generation: 1, candidates: Array(17).fill(candidate) }).success,
    ).toBe(false);
  });
});
