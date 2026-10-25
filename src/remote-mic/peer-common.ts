/**
 * Pieces shared by the Remote Microphone receiver (MacBook) and sender
 * (iPhone): injectable clocks and peer constructors, the data-channel control
 * vocabulary, and transport statistics.
 *
 * Statistics are numbers only — counters, round-trip times, candidate TYPES.
 * Never addresses, never SDP, never audio.
 */
import type { RemoteMicIceConfig } from "./protocol";

export interface PeerDeps {
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export function resolvePeerDeps(deps: PeerDeps) {
  return {
    createPeerConnection:
      deps.createPeerConnection ?? ((config: RTCConfiguration) => new RTCPeerConnection(config)),
    now: deps.now ?? (() => Date.now()),
    setTimer: deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms)),
    clearTimer: deps.clearTimer ?? ((handle: ReturnType<typeof setTimeout>) => clearTimeout(handle)),
  };
}

export function rtcConfiguration(ice: RemoteMicIceConfig | null): RTCConfiguration {
  return {
    iceServers: ice?.iceServers ?? [],
    iceTransportPolicy: ice?.iceTransportPolicy ?? "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  };
}

/** Whether WebRTC exists at all in this browser. */
export function webRtcSupported(): boolean {
  return typeof window !== "undefined" && typeof window.RTCPeerConnection === "function";
}

export function randomPeerId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Control messages over the WebRTC data channel. Tiny, typed, validated. */
export type ControlMessage =
  | { t: "status"; micActive: boolean; muted: boolean; interrupted: boolean }
  /** The phone stopped its microphone on purpose. */
  | { t: "stop"; reason: "user" | "interrupted" }
  /** The MacBook ended the pairing. */
  | { t: "end" };

export function parseControl(data: unknown): ControlMessage | null {
  if (typeof data !== "string" || data.length > 512) return null;
  try {
    const value = JSON.parse(data) as Partial<ControlMessage> & Record<string, unknown>;
    if (value.t === "status") {
      return {
        t: "status",
        micActive: value.micActive === true,
        muted: value.muted === true,
        interrupted: value.interrupted === true,
      };
    }
    if (value.t === "stop") return { t: "stop", reason: value.reason === "interrupted" ? "interrupted" : "user" };
    if (value.t === "end") return { t: "end" };
  } catch {
    return null;
  }
  return null;
}

export function sendControl(channel: RTCDataChannel | null, message: ControlMessage) {
  if (channel?.readyState !== "open") return;
  try {
    channel.send(JSON.stringify(message));
  } catch {
    // A closing channel; the connection-state handlers will report it.
  }
}

export type CandidateType = "host" | "srflx" | "prflx" | "relay";

export interface TransportStats {
  /** Selected candidate pair round trip, ms. */
  rttMs: number | null;
  /** RTP interarrival jitter, ms. */
  jitterMs: number | null;
  /** Average time samples waited in the receiver's jitter buffer, ms. */
  jitterBufferMs: number | null;
  packetsReceived: number;
  packetsLost: number;
  /** Loss over the last sampling interval, percent. */
  recentLossPct: number | null;
  bytesReceived: number;
  /** Bytes grew since the last sample — RTP is actually arriving. */
  flowing: boolean;
  localCandidateType: CandidateType | null;
  remoteCandidateType: CandidateType | null;
  /**
   * Network + buffering share of the audio delay: half the round trip plus the
   * jitter buffer, plus one 20 ms Opus frame. An estimate, labelled as one —
   * it excludes capture/playout buffers on either device.
   */
  estimatedTransportMs: number | null;
}

export const EMPTY_STATS: TransportStats = {
  rttMs: null,
  jitterMs: null,
  jitterBufferMs: null,
  packetsReceived: 0,
  packetsLost: 0,
  recentLossPct: null,
  bytesReceived: 0,
  flowing: false,
  localCandidateType: null,
  remoteCandidateType: null,
  estimatedTransportMs: null,
};

interface StatsMemory {
  packetsReceived: number;
  packetsLost: number;
  bytesReceived: number;
  jitterBufferDelay: number;
  jitterBufferEmittedCount: number;
}

/** Summarise one `getStats()` report for an inbound audio receiver. */
export function summariseInboundStats(
  report: RTCStatsReport,
  previous: StatsMemory | null,
): { stats: TransportStats; memory: StatsMemory } {
  const entries: Array<Record<string, unknown>> = [];
  report.forEach((value) => entries.push(value as unknown as Record<string, unknown>));
  const byId = new Map(entries.map((entry) => [String(entry.id), entry]));

  const inbound = entries.find((entry) => entry.type === "inbound-rtp" && entry.kind === "audio");
  const transport = entries.find((entry) => entry.type === "transport");
  const pair =
    (transport?.selectedCandidatePairId ? byId.get(String(transport.selectedCandidatePairId)) : undefined) ??
    entries.find((entry) => entry.type === "candidate-pair" && (entry.selected === true || entry.nominated === true) && entry.state === "succeeded");

  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const memory: StatsMemory = {
    packetsReceived: num(inbound?.packetsReceived),
    packetsLost: Math.max(0, num(inbound?.packetsLost)),
    bytesReceived: num(inbound?.bytesReceived),
    jitterBufferDelay: num(inbound?.jitterBufferDelay),
    jitterBufferEmittedCount: num(inbound?.jitterBufferEmittedCount),
  };

  const rttMs =
    typeof pair?.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1000) : null;
  const jitterMs = typeof inbound?.jitter === "number" ? Math.round(inbound.jitter * 1000) : null;

  let jitterBufferMs: number | null = null;
  let recentLossPct: number | null = null;
  if (previous) {
    const emitted = memory.jitterBufferEmittedCount - previous.jitterBufferEmittedCount;
    if (emitted > 0) {
      jitterBufferMs = Math.round(((memory.jitterBufferDelay - previous.jitterBufferDelay) / emitted) * 1000);
    }
    const received = memory.packetsReceived - previous.packetsReceived;
    const lost = memory.packetsLost - previous.packetsLost;
    if (received + lost > 0) recentLossPct = Math.round((Math.max(0, lost) / (received + lost)) * 1000) / 10;
  } else if (memory.jitterBufferEmittedCount > 0) {
    jitterBufferMs = Math.round((memory.jitterBufferDelay / memory.jitterBufferEmittedCount) * 1000);
  }

  const candidateType = (id: unknown): CandidateType | null => {
    const candidate = id ? byId.get(String(id)) : undefined;
    const type = candidate?.candidateType;
    return type === "host" || type === "srflx" || type === "prflx" || type === "relay" ? type : null;
  };

  const estimatedTransportMs =
    rttMs !== null ? Math.round(rttMs / 2 + (jitterBufferMs ?? 0) + 20) : null;

  return {
    memory,
    stats: {
      rttMs,
      jitterMs,
      jitterBufferMs,
      packetsReceived: memory.packetsReceived,
      packetsLost: memory.packetsLost,
      recentLossPct,
      bytesReceived: memory.bytesReceived,
      flowing: previous ? memory.bytesReceived > previous.bytesReceived : memory.bytesReceived > 0,
      localCandidateType: candidateType(pair?.localCandidateId),
      remoteCandidateType: candidateType(pair?.remoteCandidateId),
      estimatedTransportMs,
    },
  };
}
