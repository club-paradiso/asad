/**
 * Remote Microphone receiver — the MacBook end.
 *
 * Opens a pairing, waits for a phone, lets the operator approve it, then
 * answers the phone's WebRTC offer — or, when the phone could not reach this
 * computer directly and switched to the ASAD server relay, reads its audio
 * frames — and exposes the ONE incoming audio track as a MediaStream. That stream is handed to ASAD's existing `MicrophoneCapture`
 * unchanged; nothing downstream knows the audio came from a phone.
 *
 * Framework-free and dependency-injected, like the interpretation engine and
 * the transport supervisor: it is a state machine with timers, and the rules
 * are worth testing without React.
 *
 * Invariants:
 *  - at most one RTCPeerConnection and one live audio track at any time; a
 *    replacement peer closes the old one first, so the stream is never doubled;
 *  - video is refused, even from a modified sender;
 *  - this class never opens a local microphone — there is no code path here
 *    that could substitute the MacBook's own input for the phone.
 */
import { RemoteMicApiError, type RemoteMicApi } from "./client";
import {
  RELAY_FRAME_MS,
  pairingUrl,
  type RemoteMicEndReason,
  type RemoteMicIceConfig,
  type RemoteMicTransport,
  type RemoteMicView,
  type SignalCandidate,
  type SignalDescription,
} from "./protocol";
import { createBrowserRelayPlayout, type RelayPlayout, type RelayPlayoutSink } from "./relay-audio";
import { base64ToBytes, decodeMulaw } from "./relay-codec";
import {
  EMPTY_STATS,
  parseControl,
  resolvePeerDeps,
  rtcConfiguration,
  sendControl,
  summariseInboundStats,
  type PeerDeps,
  type TransportStats,
} from "./peer-common";

export type ReceiverPhase =
  | "idle"
  /** Asking the server for a pairing. */
  | "creating"
  /** QR on screen; no phone yet. */
  | "waiting"
  /** A phone claimed the link; the operator must approve it. */
  | "awaiting-approval"
  /** Approved; waiting for / negotiating the phone's offer. */
  | "connecting"
  | "connected"
  /** The phone stopped its microphone deliberately. Pairing intact. */
  | "paused"
  /** Network path lost; the phone is attempting to recover. */
  | "interrupted"
  /** Recovery did not succeed in time. */
  | "failed"
  | "ended"
  /** Could not create a pairing, or the pairing became unusable. */
  | "error";

export type ReceiverErrorCode =
  | "SHARED_STORE_REQUIRED"
  | "ACCESS_REQUIRED"
  | "RATE_LIMITED"
  | "SIGNALING_UNAVAILABLE"
  | "PAIRING_EXPIRED"
  | "ICE_FAILED"
  | "NEGOTIATION_FAILED"
  | "UNSUPPORTED";

export interface ReceiverMetrics {
  createdAt: number | null;
  claimedAt: number | null;
  approvedAt: number | null;
  connectedAt: number | null;
  /** Pairing created → phone claimed. Includes the human scanning the QR. */
  pairingMs: number | null;
  /** Approval → WebRTC connected. Pure negotiation time. */
  connectMs: number | null;
  /** Times the peer recovered after an interruption. */
  reconnects: number;
  /** Times the connection dropped. */
  interruptions: number;
}

export interface ReceiverSnapshot {
  phase: ReceiverPhase;
  pairingUrl: string | null;
  expiresAt: number | null;
  confirmCode: string | null;
  stream: MediaStream | null;
  /** Live audio tracks currently held. Must never exceed 1. */
  liveTracks: number;
  /** The track exists but RTP stopped arriving (track `mute`). */
  trackMuted: boolean;
  sender: { micActive: boolean; muted: boolean; interrupted: boolean } | null;
  error: { code: ReceiverErrorCode; message: string } | null;
  endedReason: RemoteMicEndReason | null;
  turn: boolean;
  /** How the phone's audio is arriving, once it is. */
  transport: RemoteMicTransport | null;
  stats: TransportStats;
  metrics: ReceiverMetrics;
}

export interface ReceiverDeps extends PeerDeps {
  api: RemoteMicApi;
  /** `window.location.origin` — the origin the phone must open. */
  origin: string;
  /**
   * Chromium only delivers a remote WebRTC track's samples to Web Audio while
   * the stream is also attached to a media element. The default attaches a
   * muted, never-rendered <audio>; nothing is ever played aloud.
   */
  attachSink?: (stream: MediaStream) => () => void;
  /** How long an interruption may last before it is reported as a failure. */
  interruptionGraceMs?: number;
  /**
   * Builds the relay's audio playout. Called from the Pair/Approve clicks:
   * Safari only starts Web Audio from a user gesture. Null disables relay
   * reception (the phone's relay then never connects).
   */
  createRelayPlayout?: (() => RelayPlayout | null) | null;
}

const POLL_MS = {
  waiting: 1000,
  negotiating: 350,
  connected: 4000,
  interrupted: 1000,
} as const;
const HEARTBEAT_MS = 15_000;
const STATS_MS = 2000;
const DEFAULT_INTERRUPTION_GRACE_MS = 45_000;
const MAX_POLL_FAILURES_BEFORE_REPORT = 4;
/** Relay frames older than this many in one read are skipped: live beats complete. */
const RELAY_MAX_BACKLOG_FRAMES = 4;
/** No relay frame for this long while the phone says it is sending: "no audio arriving". */
const RELAY_STALL_MS = 2500;
/** A phone that reported "closed" and sent nothing for this long has stopped its mic. */
const RELAY_PAUSE_QUIET_MS = 1500;
const RELAY_FAILURES_BEFORE_REPORT = 4;

function defaultAttachSink(stream: MediaStream): () => void {
  if (typeof document === "undefined") return () => {};
  const element = document.createElement("audio");
  element.muted = true;
  element.autoplay = true;
  element.setAttribute("playsinline", "");
  element.srcObject = stream;
  void element.play().catch(() => {});
  return () => {
    element.pause();
    element.srcObject = null;
  };
}

export const IDLE_RECEIVER_SNAPSHOT: ReceiverSnapshot = {
  phase: "idle",
  pairingUrl: null,
  expiresAt: null,
  confirmCode: null,
  stream: null,
  liveTracks: 0,
  trackMuted: false,
  sender: null,
  error: null,
  endedReason: null,
  turn: false,
  transport: null,
  stats: EMPTY_STATS,
  metrics: {
    createdAt: null,
    claimedAt: null,
    approvedAt: null,
    connectedAt: null,
    pairingMs: null,
    connectMs: null,
    reconnects: 0,
    interruptions: 0,
  },
};

export class RemoteMicReceiver {
  private readonly deps: ReturnType<typeof resolvePeerDeps>;
  private readonly listeners = new Set<() => void>();
  private state: ReceiverSnapshot = {
    phase: "idle",
    pairingUrl: null,
    expiresAt: null,
    confirmCode: null,
    stream: null,
    liveTracks: 0,
    trackMuted: false,
    sender: null,
    error: null,
    endedReason: null,
    turn: false,
    transport: null,
    stats: EMPTY_STATS,
    metrics: {
      createdAt: null,
      claimedAt: null,
      approvedAt: null,
      connectedAt: null,
      pairingMs: null,
      connectMs: null,
      reconnects: 0,
      interruptions: 0,
    },
  };

  private id: string | null = null;
  private token: string | null = null;
  private ice: RemoteMicIceConfig | null = null;
  private cursor = 0;
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private peerId: string | null = null;
  private generation = 0;
  private answeredGeneration = 0;
  private remoteDescriptionSet = false;
  private pendingRemote: SignalCandidate[] = [];
  private pendingLocal: RTCIceCandidateInit[] = [];
  private flushScheduled = false;
  private track: MediaStreamTrack | null = null;
  private detachSink: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setTimeout> | null = null;
  private interruptionTimer: ReturnType<typeof setTimeout> | null = null;
  private statsMemory: Parameters<typeof summariseInboundStats>[1] = null;
  private pollFailures = 0;
  private busy: Promise<void> = Promise.resolve();
  private disposed = false;
  private everConnected = false;
  /** An offer is being negotiated; poll fast until the peer connects. */
  private negotiating = false;
  /** An answer created locally whose POST has not yet succeeded. */
  private pendingAnswer: { sdp: string; generation: number; peerId: string } | null = null;

  /* Relay reception. */
  private relayPlayout: RelayPlayout | null = null;
  private relaySink: RelayPlayoutSink | null = null;
  private relayReading = false;
  private relayTimer: ReturnType<typeof setTimeout> | null = null;
  private relayCursor = "";
  private relayLastN = -1;
  private relayLastFrameAt = 0;
  private relayFailures = 0;
  private relayStats = { frames: 0, lost: 0, bytes: 0, windowFrames: 0, windowLost: 0, rttMs: null as number | null };

  constructor(private readonly options: ReceiverDeps) {
    this.deps = resolvePeerDeps(options);
  }

  /* --- Subscription --------------------------------------------------------- */

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ReceiverSnapshot {
    return this.state;
  }

  /** The stream the live session should capture, or null. Never a local mic. */
  currentStream(): MediaStream | null {
    const stream = this.state.stream;
    return stream && stream.getAudioTracks().some((track) => track.readyState === "live") ? stream : null;
  }

  private set(patch: Partial<ReceiverSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private setMetrics(patch: Partial<ReceiverMetrics>) {
    this.set({ metrics: { ...this.state.metrics, ...patch } });
  }

  /* --- Operator actions ----------------------------------------------------- */

  /** Open a new pairing. Ends any previous one first. */
  async pair(): Promise<void> {
    if (this.disposed) return;
    if (this.state.phase === "creating") return;
    this.prepareRelay();
    await this.teardownPairing(true);
    this.set({
      phase: "creating",
      error: null,
      endedReason: null,
      confirmCode: null,
      pairingUrl: null,
      sender: null,
      transport: null,
      stats: EMPTY_STATS,
      metrics: {
        createdAt: null,
        claimedAt: null,
        approvedAt: null,
        connectedAt: null,
        pairingMs: null,
        connectMs: null,
        reconnects: 0,
        interruptions: 0,
      },
    });
    try {
      const created = await this.options.api.create();
      if (this.disposed) {
        void this.options.api.end(created.id, created.receiverToken).catch(() => {});
        return;
      }
      this.id = created.id;
      this.token = created.receiverToken;
      this.ice = created.ice;
      this.cursor = 0;
      this.everConnected = false;
      this.set({
        phase: "waiting",
        pairingUrl: pairingUrl(this.options.origin, created.id, created.pairingSecret),
        expiresAt: created.expiresAt,
        turn: created.ice.turn,
      });
      this.setMetrics({ createdAt: this.deps.now() });
      this.schedulePoll(0);
    } catch (error) {
      this.set({ phase: "error", error: this.classifyCreateError(error) });
    }
  }

  async approve(): Promise<void> {
    if (!this.id || !this.token || this.state.phase !== "awaiting-approval") return;
    this.prepareRelay();
    try {
      await this.options.api.signal(this.token, { action: "approve", id: this.id });
      this.set({ phase: "connecting" });
      this.setMetrics({ approvedAt: this.deps.now() });
      this.startHeartbeat();
      this.schedulePoll(0);
    } catch (error) {
      this.handleSignalError(error);
    }
  }

  async reject(): Promise<void> {
    if (!this.id || !this.token) return;
    await this.options.api.signal(this.token, { action: "reject", id: this.id }).catch(() => {});
    await this.finish("rejected", false);
  }

  /** End the pairing for both devices. Idempotent. */
  async end(): Promise<void> {
    await this.finish("receiver-ended", true);
  }

  /** Release everything without further state updates (unmount). */
  dispose(): void {
    if (this.disposed) return;
    void this.finish("receiver-ended", true);
    this.disposed = true;
    this.relayPlayout?.close();
    this.relayPlayout = null;
    this.listeners.clear();
  }

  /* --- Polling -------------------------------------------------------------- */

  private schedulePoll(ms: number) {
    if (this.pollTimer) this.deps.clearTimer(this.pollTimer);
    this.pollTimer = this.deps.setTimer(() => {
      this.pollTimer = null;
      void this.pollOnce();
    }, ms);
  }

  private nextPollDelay(): number {
    // A renegotiation in flight, or a track that has gone quiet (the phone
    // may already be offering a replacement peer while this one still reads
    // "connected"): check promptly rather than at the steady-state pace.
    if (this.negotiating) return POLL_MS.negotiating;
    if (this.state.phase === "connected" && this.state.trackMuted) return POLL_MS.interrupted;
    switch (this.state.phase) {
      case "waiting":
      case "awaiting-approval":
        return POLL_MS.waiting;
      case "connecting":
        return POLL_MS.negotiating;
      case "connected":
      case "paused":
        return POLL_MS.connected;
      case "interrupted":
        return POLL_MS.interrupted;
      default:
        return POLL_MS.waiting;
    }
  }

  private async pollOnce(): Promise<void> {
    const { id, token } = this;
    if (!id || !token || this.disposed) return;
    try {
      const view = await this.options.api.poll(id, token, this.cursor);
      if (this.id !== id) return;
      this.pollFailures = 0;
      await this.serial(() => this.handleView(view));
      if (this.pendingAnswer) await this.serial(() => this.deliverAnswer());
    } catch (error) {
      if (this.id !== id) return;
      if (error instanceof RemoteMicApiError && (error.status === 404 || error.status === 410)) {
        await this.finish("expired", false);
        return;
      }
      if (error instanceof RemoteMicApiError && error.code === "SHARED_STORE_REQUIRED") {
        this.set({ phase: "error", error: this.classifyCreateError(error) });
        return;
      }
      this.pollFailures += 1;
      if (this.pollFailures >= MAX_POLL_FAILURES_BEFORE_REPORT && this.state.phase !== "connected") {
        this.set({
          error: {
            code: "SIGNALING_UNAVAILABLE",
            message: "연결 서버에 닿지 않습니다. 네트워크를 확인하세요. 계속 다시 시도합니다.",
          },
        });
      }
    }
    if (this.id === id && !this.disposed && this.state.phase !== "ended" && this.state.phase !== "error") {
      this.schedulePoll(this.pollFailures ? Math.min(8000, 1000 * 2 ** this.pollFailures) : this.nextPollDelay());
    }
  }

  /** Run state-changing work one step at a time; offers must not interleave. */
  private serial(work: () => Promise<void>): Promise<void> {
    const next = this.busy.then(work, work);
    this.busy = next.catch(() => {});
    return next;
  }

  private async handleView(view: RemoteMicView) {
    if (view.state === "ended") {
      await this.finish(view.endedReason ?? "sender-ended", false);
      return;
    }
    if (this.state.error?.code === "SIGNALING_UNAVAILABLE") this.set({ error: null });
    this.set({ expiresAt: view.expiresAt });

    if (view.state === "claimed" && this.state.phase === "waiting") {
      const now = this.deps.now();
      this.set({ phase: "awaiting-approval", confirmCode: view.confirmCode });
      this.setMetrics({
        claimedAt: now,
        pairingMs: this.state.metrics.createdAt ? now - this.state.metrics.createdAt : null,
      });
    }
    if (view.confirmCode && view.confirmCode !== this.state.confirmCode) {
      this.set({ confirmCode: view.confirmCode });
    }
    if (view.peer) {
      this.set({
        sender: {
          micActive: view.peer.micActive,
          muted: view.peer.muted,
          interrupted: this.state.sender?.interrupted ?? false,
        },
      });
    }

    if (view.state !== "approved") return;
    if (this.state.phase === "awaiting-approval") this.set({ phase: "connecting" });

    if (view.transport === "relay") {
      this.handleRelayView(view);
      return;
    }
    if (this.relayReading) {
      // The phone went back to a direct attempt; its offer follows.
      this.stopRelay();
      this.set({ phase: "connecting", transport: null });
    }

    if (view.description && view.description.generation > this.answeredGeneration) {
      await this.handleOffer(view.description);
    }
    for (const candidate of view.candidates) {
      if (candidate.generation !== this.generation) continue;
      if (this.remoteDescriptionSet) await this.addRemoteCandidate(candidate);
      else this.pendingRemote.push(candidate);
    }
    this.cursor = Math.max(this.cursor, view.cursor);
  }

  /* --- Negotiation ---------------------------------------------------------- */

  private async handleOffer(offer: SignalDescription) {
    if (/^m=video/m.test(offer.sdp) || !/^m=audio/m.test(offer.sdp)) {
      // A modified client asked for video, or sent no audio. Refuse outright.
      this.set({
        error: { code: "NEGOTIATION_FAILED", message: "오디오 전용 연결만 허용됩니다. 연결을 거부했습니다." },
      });
      this.answeredGeneration = offer.generation;
      return;
    }

    this.negotiating = true;
    if (!this.pc || this.peerId !== offer.peerId) {
      // A different sender peer: the phone reloaded or restarted its mic.
      // Close the old peer FIRST so two tracks can never coexist.
      this.closePeer();
      this.pc = this.createPeer();
      this.peerId = offer.peerId;
      // The old stream is gone; do not keep claiming "connected".
      this.set({ phase: "connecting" });
    }
    const pc = this.pc;
    this.generation = offer.generation;
    this.remoteDescriptionSet = false;
    this.pendingRemote = [];
    this.pendingLocal = [];

    try {
      await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
      this.remoteDescriptionSet = true;
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const sdp = pc.localDescription?.sdp ?? answer.sdp ?? "";
      this.answeredGeneration = offer.generation;
      if (this.state.phase !== "connected") this.set({ phase: "connecting" });
      const queued = this.pendingRemote.splice(0);
      for (const candidate of queued) await this.addRemoteCandidate(candidate);
      // Delivery is retried on later polls if it fails: the local answer is
      // already set, so losing the POST must not strand the phone's offer.
      this.pendingAnswer = { sdp, generation: offer.generation, peerId: offer.peerId };
      await this.deliverAnswer();
    } catch (error) {
      if (error instanceof RemoteMicApiError && error.code === "STALE_GENERATION") return;
      this.answeredGeneration = offer.generation;
      this.set({
        error: {
          code: "NEGOTIATION_FAILED",
          message: "휴대폰과 연결 조건을 맞추지 못했습니다. 휴대폰에서 「다시 연결」을 눌러 주세요.",
        },
      });
    }
  }

  /** Post the pending answer. Transient failures keep it for the next poll. */
  private async deliverAnswer() {
    const pending = this.pendingAnswer;
    if (!pending || !this.id || !this.token) return;
    try {
      await this.options.api.signal(this.token, { action: "answer", id: this.id, ...pending });
    } catch (error) {
      if (error instanceof RemoteMicApiError && (error.code === "STALE_GENERATION" || error.status === 404 || error.status === 410)) {
        if (this.pendingAnswer === pending) this.pendingAnswer = null;
        return;
      }
      return; // keep it; pollOnce retries
    }
    if (this.pendingAnswer === pending) this.pendingAnswer = null;
    this.flushLocalCandidates();
  }

  private async addRemoteCandidate(candidate: SignalCandidate) {
    if (!this.pc || !candidate.candidate) return;
    try {
      await this.pc.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      });
    } catch {
      // One unusable candidate is normal (e.g. an IPv6 path on an IPv4 LAN).
    }
  }

  private createPeer(): RTCPeerConnection {
    const pc = this.deps.createPeerConnection(rtcConfiguration(this.ice));
    pc.ontrack = (event) => {
      if (this.pc !== pc) return;
      if (event.track.kind !== "audio") {
        event.track.stop();
        return;
      }
      this.adoptTrack(event.track);
    };
    pc.onicecandidate = (event) => {
      if (this.pc !== pc || !event.candidate?.candidate) return;
      this.pendingLocal.push(event.candidate.toJSON());
      this.scheduleLocalFlush();
    };
    pc.ondatachannel = (event) => {
      if (this.pc !== pc) return;
      this.attachChannel(event.channel);
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      this.onConnectionState(pc.connectionState);
    };
    return pc;
  }

  private scheduleLocalFlush() {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    // Batch candidates gathered in the same burst into one request.
    this.deps.setTimer(() => {
      this.flushScheduled = false;
      this.flushLocalCandidates();
    }, 60);
  }

  private flushLocalCandidates() {
    if (!this.id || !this.token || this.answeredGeneration !== this.generation) return;
    const batch = this.pendingLocal.splice(0, 16);
    if (batch.length === 0) return;
    void this.options.api
      .signal(this.token, {
        action: "candidates",
        id: this.id,
        generation: this.generation,
        candidates: batch.map((candidate) => ({
          candidate: candidate.candidate ?? "",
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        })),
      })
      .catch(() => {});
    if (this.pendingLocal.length) this.scheduleLocalFlush();
  }

  private adoptTrack(track: MediaStreamTrack) {
    if (this.track === track) return;
    // Exactly one remote track. A replacement stops and forgets the previous.
    this.releaseTrack();
    this.track = track;
    const stream = new MediaStream([track]);
    this.detachSink = (this.options.attachSink ?? defaultAttachSink)(stream);
    track.onmute = () => this.track === track && this.set({ trackMuted: true });
    track.onunmute = () => this.track === track && this.set({ trackMuted: false });
    track.onended = () => {
      if (this.track !== track) return;
      this.set({ liveTracks: 0 });
    };
    this.set({ stream, liveTracks: 1, trackMuted: track.muted });
  }

  private releaseTrack() {
    this.detachSink?.();
    this.detachSink = null;
    this.relaySink?.close();
    this.relaySink = null;
    if (this.track) {
      const track = this.track;
      track.onmute = null;
      track.onunmute = null;
      track.onended = null;
      track.stop();
      // `stop()` never fires `ended` (by specification), so a consumer — the
      // live session's MicrophoneCapture — would keep capturing a dead track
      // and send silence. Tell it the track ended, so it reports the loss and
      // recovers onto the replacement stream instead.
      try {
        track.dispatchEvent(new Event("ended"));
      } catch {
        // Non-DOM track (tests); nothing is listening.
      }
    }
    this.track = null;
    if (this.state.stream || this.state.liveTracks) this.set({ stream: null, liveTracks: 0 });
  }

  private attachChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onmessage = (event) => {
      if (this.channel !== channel) return;
      const message = parseControl(event.data);
      if (!message) return;
      if (message.t === "status") {
        this.set({
          sender: { micActive: message.micActive, muted: message.muted, interrupted: message.interrupted },
        });
      } else if (message.t === "stop") {
        // Deliberate stop on the phone: close the peer so the track ENDS and
        // the live capture sees a clean end rather than a silent stream.
        this.closePeer();
        this.set({
          phase: "paused",
          sender: { micActive: false, muted: false, interrupted: message.reason === "interrupted" },
        });
      }
    };
  }

  private onConnectionState(state: RTCPeerConnectionState) {
    if (state === "connected") {
      this.negotiating = false;
      this.clearInterruptionTimer();
      const now = this.deps.now();
      if (!this.everConnected) {
        this.everConnected = true;
        const approvedAt = this.state.metrics.approvedAt;
        this.setMetrics({ connectedAt: now, connectMs: approvedAt ? now - approvedAt : null });
      } else if (this.state.phase === "interrupted") {
        this.setMetrics({ reconnects: this.state.metrics.reconnects + 1 });
      }
      this.set({ phase: "connected", error: null, transport: "direct" });
      this.postStatus("connected");
      this.startStats();
    } else if (state === "disconnected" || state === "failed") {
      if (this.state.phase === "connected") {
        this.setMetrics({ interruptions: this.state.metrics.interruptions + 1 });
      }
      if (this.state.phase !== "paused") this.set({ phase: "interrupted" });
      this.postStatus(state);
      this.armInterruptionTimer();
    }
  }

  private armInterruptionTimer() {
    if (this.interruptionTimer) return;
    this.interruptionTimer = this.deps.setTimer(() => {
      this.interruptionTimer = null;
      if (this.state.phase !== "interrupted") return;
      this.set({
        phase: "failed",
        error: {
          code: "ICE_FAILED",
          message:
            "휴대폰과의 연결이 복구되지 않았습니다. 두 기기의 인터넷 연결을 확인하고 휴대폰에서 「다시 연결」을 누르세요.",
        },
      });
    }, this.options.interruptionGraceMs ?? DEFAULT_INTERRUPTION_GRACE_MS);
  }

  private clearInterruptionTimer() {
    if (this.interruptionTimer) this.deps.clearTimer(this.interruptionTimer);
    this.interruptionTimer = null;
  }

  /* --- Heartbeat & statistics ---------------------------------------------- */

  private postStatus(connection: RTCPeerConnectionState) {
    if (!this.id || !this.token) return;
    void this.options.api
      .signal(this.token, {
        action: "status",
        id: this.id,
        connection,
        micActive: this.state.liveTracks > 0,
        muted: false,
      })
      .catch(() => {});
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) this.deps.clearTimer(this.heartbeatTimer);
    this.heartbeatTimer = this.deps.setTimer(() => {
      this.heartbeatTimer = null;
      if (!this.id || this.state.phase === "ended" || this.state.phase === "error") return;
      this.postStatus(this.relayReading ? (this.relaySink ? "connected" : "connecting") : (this.pc?.connectionState ?? "new"));
      this.startHeartbeat();
    }, HEARTBEAT_MS);
  }

  private startStats() {
    if (this.statsTimer) return;
    const sample = async () => {
      this.statsTimer = null;
      const pc = this.pc;
      if (!pc || this.state.phase === "ended") return;
      try {
        const report = await pc.getStats();
        if (this.pc !== pc) return;
        const { stats, memory } = summariseInboundStats(report, this.statsMemory);
        this.statsMemory = memory;
        this.set({ stats });
      } catch {
        // Stats are diagnostic; never let them break the audio path.
      }
      if (this.pc === pc) this.statsTimer = this.deps.setTimer(() => void sample(), STATS_MS);
    };
    this.statsTimer = this.deps.setTimer(() => void sample(), 500);
  }

  /* --- Server relay reception ----------------------------------------------- */

  private prepareRelay() {
    if (this.relayPlayout || this.disposed) return;
    const factory = this.options.createRelayPlayout === undefined ? createBrowserRelayPlayout : this.options.createRelayPlayout;
    if (!factory) return;
    try {
      this.relayPlayout = factory();
    } catch {
      this.relayPlayout = null;
    }
  }

  private handleRelayView(view: RemoteMicView) {
    if (this.pc) this.closePeer();
    this.negotiating = false;
    if (this.state.transport !== "relay") this.set({ transport: "relay" });
    if (!this.relayPlayout) {
      this.set({
        phase: "failed",
        error: { code: "UNSUPPORTED", message: "이 브라우저는 서버 중계 오디오를 재생할 수 없습니다. 최신 Chrome·Safari·Edge로 여세요." },
      });
      return;
    }
    const quiet = this.deps.now() - this.relayLastFrameAt > RELAY_PAUSE_QUIET_MS;
    if (view.peer?.connection === "closed" && quiet) {
      // The phone stopped its microphone: end the track so the live capture
      // sees a clean end, exactly as with a direct connection.
      if (this.relaySink) this.releaseTrack();
      if (this.state.phase !== "paused" && this.state.phase !== "connecting") {
        this.set({ phase: "paused", sender: { micActive: false, muted: false, interrupted: false } });
      }
    }
    this.startRelayReader();
  }

  private startRelayReader() {
    if (this.relayReading) return;
    this.relayReading = true;
    this.relayFailures = 0;
    this.scheduleRelayRead(0);
  }

  private scheduleRelayRead(ms: number) {
    if (this.relayTimer) this.deps.clearTimer(this.relayTimer);
    this.relayTimer = this.deps.setTimer(() => {
      this.relayTimer = null;
      void this.readRelayOnce();
    }, ms);
  }

  private stopRelay() {
    this.relayReading = false;
    if (this.relayTimer) this.deps.clearTimer(this.relayTimer);
    this.relayTimer = null;
    if (this.relaySink) this.releaseTrack();
  }

  private async readRelayOnce() {
    const { id, token } = this;
    if (!id || !token || !this.relayReading || this.disposed) return;
    const startedAt = this.deps.now();
    let delay = RELAY_FRAME_MS;
    try {
      const response = await this.options.api.relayRead(id, token, this.relayCursor);
      if (this.id !== id || !this.relayReading) return;
      this.relayStats.rttMs = this.deps.now() - startedAt;
      this.relayCursor = response.cursor || this.relayCursor;
      if (this.relayFailures >= RELAY_FAILURES_BEFORE_REPORT && this.state.phase === "interrupted") {
        this.clearInterruptionTimer();
        this.setMetrics({ reconnects: this.state.metrics.reconnects + 1 });
        this.set({ phase: this.relaySink ? "connected" : "connecting", error: null });
      }
      this.relayFailures = 0;
      this.acceptRelayFrames(response.frames);
    } catch (error) {
      if (this.id !== id) return;
      if (error instanceof RemoteMicApiError && (error.status === 404 || error.status === 410)) {
        await this.finish("expired", false);
        return;
      }
      if (!(error instanceof RemoteMicApiError && error.status === 409)) {
        this.relayFailures += 1;
        if (this.relayFailures === RELAY_FAILURES_BEFORE_REPORT && this.state.phase === "connected") {
          this.setMetrics({ interruptions: this.state.metrics.interruptions + 1 });
          this.set({ phase: "interrupted" });
          this.armInterruptionTimer();
        }
        delay = Math.min(4000, RELAY_FRAME_MS * 2 ** Math.min(4, this.relayFailures));
      }
    }
    this.updateRelayStats();
    if (this.relayReading && this.id === id && !this.disposed) this.scheduleRelayRead(delay);
  }

  private acceptRelayFrames(frames: Array<{ n: number; a: string }>) {
    if (frames.length === 0) return;
    // A backlog (slow network, a tab that was throttled) is skipped: an
    // interpreter needs what is being said now.
    const skipped = Math.max(0, frames.length - RELAY_MAX_BACKLOG_FRAMES);
    const live = skipped ? frames.slice(skipped) : frames;
    if (!this.relaySink && !this.openRelaySink()) return;
    const sink = this.relaySink!;
    for (const frame of live) {
      let samples: Float32Array;
      try {
        const bytes = base64ToBytes(frame.a);
        samples = decodeMulaw(bytes);
        this.relayStats.bytes += bytes.length;
      } catch {
        continue;
      }
      const gap = this.relayLastN >= 0 && frame.n > this.relayLastN + 1 ? frame.n - this.relayLastN - 1 : 0;
      this.relayStats.lost += gap;
      this.relayStats.windowLost += gap;
      this.relayLastN = Math.max(this.relayLastN, frame.n);
      this.relayStats.frames += 1;
      this.relayStats.windowFrames += 1;
      sink.push(samples);
    }
    this.relayStats.lost += skipped;
    this.relayStats.windowLost += skipped;
    this.relayLastFrameAt = this.deps.now();
    if (this.state.trackMuted) this.set({ trackMuted: false });
    if (this.state.phase !== "connected" && this.state.phase !== "interrupted") this.markRelayConnected();
  }

  private openRelaySink(): boolean {
    const sink = this.relayPlayout?.open() ?? null;
    const track = sink?.stream.getAudioTracks()[0];
    if (!sink || !track) {
      sink?.close();
      return false;
    }
    this.adoptTrack(track);
    this.relaySink = sink;
    return true;
  }

  private markRelayConnected() {
    const now = this.deps.now();
    if (!this.everConnected) {
      this.everConnected = true;
      const approvedAt = this.state.metrics.approvedAt;
      this.setMetrics({ connectedAt: now, connectMs: approvedAt ? now - approvedAt : null });
    }
    this.set({
      phase: "connected",
      error: null,
      transport: "relay",
      sender: { micActive: true, muted: this.state.sender?.muted ?? false, interrupted: false },
    });
    this.postStatus("connected");
  }

  private updateRelayStats() {
    if (!this.relayReading) return;
    const stall = !!this.relaySink && this.deps.now() - this.relayLastFrameAt > RELAY_STALL_MS;
    if (stall !== this.state.trackMuted && this.relaySink) this.set({ trackMuted: stall });
    const { frames, lost, bytes, windowFrames, windowLost, rttMs } = this.relayStats;
    // A loss figure per ~2 s window, like the WebRTC path's.
    const windowTotal = windowFrames + windowLost;
    const recentLossPct = windowTotal >= 6 ? Math.round((windowLost / windowTotal) * 1000) / 10 : this.state.stats.recentLossPct;
    if (windowTotal >= 6) {
      this.relayStats.windowFrames = 0;
      this.relayStats.windowLost = 0;
    }
    const buffered = this.relaySink?.bufferedMs() ?? null;
    this.set({
      stats: {
        rttMs,
        jitterMs: null,
        jitterBufferMs: buffered,
        packetsReceived: frames,
        packetsLost: lost,
        recentLossPct,
        bytesReceived: bytes,
        flowing: !stall && frames > 0,
        localCandidateType: null,
        remoteCandidateType: null,
        // Frame length + half a poll + one request + the playout queue: an
        // estimate of the relay's share of the delay, labelled as one.
        estimatedTransportMs:
          rttMs === null ? null : Math.round(RELAY_FRAME_MS + RELAY_FRAME_MS / 2 + rttMs + (buffered ?? 0)),
      },
    });
  }

  /* --- Teardown ------------------------------------------------------------- */

  private closePeer() {
    const pc = this.pc;
    this.pc = null;
    this.peerId = null;
    this.remoteDescriptionSet = false;
    this.pendingRemote = [];
    this.pendingLocal = [];
    this.pendingAnswer = null;
    this.statsMemory = null;
    if (this.statsTimer) this.deps.clearTimer(this.statsTimer);
    this.statsTimer = null;
    this.clearInterruptionTimer();
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel = null;
    }
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.ondatachannel = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // Already closed.
      }
    }
    this.releaseTrack();
  }

  private async teardownPairing(notifyServer: boolean) {
    const { id, token } = this;
    if (this.pollTimer) this.deps.clearTimer(this.pollTimer);
    if (this.heartbeatTimer) this.deps.clearTimer(this.heartbeatTimer);
    this.pollTimer = null;
    this.heartbeatTimer = null;
    sendControl(this.channel, { t: "end" });
    this.stopRelay();
    this.relayCursor = "";
    this.relayLastN = -1;
    this.closePeer();
    this.id = null;
    this.token = null;
    this.generation = 0;
    this.answeredGeneration = 0;
    this.cursor = 0;
    if (notifyServer && id && token) await this.options.api.end(id, token).catch(() => {});
  }

  private async finish(reason: RemoteMicEndReason, notifyServer: boolean) {
    if (this.state.phase === "ended" && !this.id) return;
    const hadPairing = !!this.id;
    await this.teardownPairing(notifyServer);
    if (this.disposed) return;
    if (!hadPairing && this.state.phase === "idle") return;
    const expiredBeforeUse = reason === "expired" && !this.everConnected;
    this.set({
      phase: expiredBeforeUse ? "error" : "ended",
      endedReason: reason,
      confirmCode: null,
      sender: null,
      error: expiredBeforeUse
        ? { code: "PAIRING_EXPIRED", message: "연결 링크가 만료되었습니다. 「휴대폰 연결」을 다시 눌러 새 QR을 만드세요." }
        : null,
    });
  }

  private handleSignalError(error: unknown) {
    if (error instanceof RemoteMicApiError && (error.status === 404 || error.status === 410)) {
      void this.finish("expired", false);
      return;
    }
    this.set({
      error: {
        code: "SIGNALING_UNAVAILABLE",
        message: "요청을 보내지 못했습니다. 잠시 후 다시 눌러 주세요.",
      },
    });
  }

  private classifyCreateError(error: unknown): { code: ReceiverErrorCode; message: string } {
    if (error instanceof RemoteMicApiError) {
      if (error.code === "SHARED_STORE_REQUIRED") {
        return {
          code: "SHARED_STORE_REQUIRED",
          message:
            "이 배포에는 원격 마이크용 공유 저장소(Upstash Redis)가 연결되지 않았습니다. 관리자가 Vercel 프로젝트에 Upstash Redis를 연결하고 다시 배포해야 합니다.",
        };
      }
      if (error.status === 401) {
        return { code: "ACCESS_REQUIRED", message: "접근 권한이 필요합니다. 페이지를 새로고침하고 접근 키를 입력하세요." };
      }
      if (error.status === 429) {
        return { code: "RATE_LIMITED", message: "너무 자주 요청했습니다. 1분 뒤에 다시 시도하세요." };
      }
    }
    return {
      code: "SIGNALING_UNAVAILABLE",
      message: "연결 서버를 사용할 수 없습니다. 네트워크를 확인한 뒤 다시 시도하세요.",
    };
  }
}
