/**
 * Remote Microphone sender — the phone end (iPhone, Android, any browser with
 * a microphone).
 *
 * Captures the phone's microphone (and nothing else), claims the pairing,
 * waits for the computer's approval and sends the audio:
 *
 *  - direct first: one Opus track over WebRTC (peer to peer, or via TURN);
 *  - if no direct path connects within a few seconds, or a dropped one cannot
 *    be recovered, the ASAD server relay: 300 ms µ-law frames over HTTPS. That
 *    works on any network that can open the ASAD site — the phone on mobile
 *    data and the computer on office Wi-Fi included.
 *
 * It never sees the recogniser, the transcript or any ASAD credential beyond
 * its own pairing-scoped token.
 *
 * Invariants:
 *  - `getUserMedia` runs only from `start()`, which the page calls from the
 *    Start button's click handler: a direct user gesture, as iOS requires;
 *  - one capture at a time: concurrent or repeated `start()` calls reuse the
 *    live stream rather than opening a second microphone;
 *  - one peer at a time, and one track on it;
 *  - reconnection is bounded: a few ICE restarts, then one fresh peer, then a
 *    clear failure the person can act on.
 */
import { RemoteMicApiError, type RemoteMicApi } from "./client";
import {
  MAX_RELAY_FRAMES_PER_POST,
  type RemoteMicEndReason,
  type RemoteMicIceConfig,
  type RemoteMicTransport,
  type RemoteMicView,
  type SignalCandidate,
} from "./protocol";
import { createBrowserRelayCapture, type RelayCapture } from "./relay-audio";
import { bytesToBase64 } from "./relay-codec";
import {
  randomPeerId,
  resolvePeerDeps,
  rtcConfiguration,
  sendControl,
  type PeerDeps,
} from "./peer-common";

export type SenderPhase =
  | "idle"
  | "requesting-mic"
  | "claiming"
  | "awaiting-approval"
  | "connecting"
  | "connected"
  | "reconnecting"
  /** The person stopped the microphone; the pairing is kept. */
  | "stopped"
  | "failed"
  | "ended";

export type SenderErrorCode =
  | "INSECURE_CONTEXT"
  | "UNSUPPORTED"
  | "PERMISSION_DENIED"
  | "NO_MICROPHONE"
  | "MIC_BUSY"
  | "MIC_INTERRUPTED"
  | "INVALID_LINK"
  | "EXPIRED"
  | "ALREADY_CLAIMED"
  | "REJECTED"
  | "SIGNALING_UNAVAILABLE"
  | "ICE_FAILED"
  | "RATE_LIMITED";

export interface SenderSnapshot {
  phase: SenderPhase;
  confirmCode: string | null;
  stream: MediaStream | null;
  muted: boolean;
  /** iOS muted the track: a call, Siri, or another app took the microphone. */
  interrupted: boolean;
  trackLabel: string;
  error: SenderErrorCode | null;
  endedReason: RemoteMicEndReason | null;
  reconnectAttempts: number;
  /** How audio is leaving the phone, once it is. */
  transport: RemoteMicTransport | null;
}

export interface StoredSenderCredential {
  id: string;
  token: string;
  ice: RemoteMicIceConfig | null;
}

export interface SenderDeps extends PeerDeps {
  api: RemoteMicApi;
  pairing: { id: string; secret: string } | null;
  /** A credential from an earlier load of this page, so a reload can rejoin. */
  stored?: StoredSenderCredential | null;
  saveCredential?: (credential: StoredSenderCredential | null) => void;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Browser voice processing. Off by default: it can remove soft consonants. */
  voiceProcessing?: boolean;
  /**
   * Builds the relay's audio capture. Called from `start()` — a tap — because
   * iOS only lets a page start Web Audio from a user gesture. Null disables
   * the relay fallback.
   */
  createRelayCapture?: (() => RelayCapture | null) | null;
  /** How long a first direct connection may take before falling back to the relay. */
  relayFallbackMs?: number;
}

const POLL_MS = { approval: 800, negotiating: 350, steady: 4000 } as const;
const HEARTBEAT_MS = 15_000;
/** Delay before each ICE restart attempt within one outage. */
const ICE_RESTART_DELAYS_MS = [2000, 5000, 10_000] as const;
/** First direct connection budget. A LAN connects in well under a second. */
const DEFAULT_RELAY_FALLBACK_MS = 8000;
/** Frames queued while a relay POST is slow; older audio is dropped first. */
const MAX_PENDING_FRAMES = MAX_RELAY_FRAMES_PER_POST;
/** Consecutive relay failures before the phone says it is reconnecting. */
const RELAY_FAILURES_BEFORE_REPORT = 3;

export function senderAudioConstraints(voiceProcessing: boolean): MediaTrackConstraints {
  return {
    channelCount: 1,
    echoCancellation: voiceProcessing,
    noiseSuppression: voiceProcessing,
    // A phone on a pulpit or a pew is far from the speaker; let the OS keep
    // the level usable. The MacBook preflight shows if it is still too quiet.
    autoGainControl: true,
  };
}

export class RemoteMicSender {
  private readonly deps: ReturnType<typeof resolvePeerDeps>;
  private readonly listeners = new Set<() => void>();
  private state: SenderSnapshot = {
    phase: "idle",
    confirmCode: null,
    stream: null,
    muted: false,
    interrupted: false,
    trackLabel: "",
    error: null,
    endedReason: null,
    reconnectAttempts: 0,
    transport: null,
  };

  private id: string | null;
  private token: string | null;
  private ice: RemoteMicIceConfig | null;
  private cursor = 0;
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private peerId: string | null = null;
  private generation = 0;
  private answerApplied = false;
  private pendingRemote: SignalCandidate[] = [];
  private pendingLocal: RTCIceCandidateInit[] = [];
  private flushScheduled = false;
  private starting: Promise<void> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private busy: Promise<void> = Promise.resolve();
  private disposed = false;
  private wantsMedia = false;

  /* Relay fallback. */
  private relayCapture: RelayCapture | null = null;
  private relayActive = false;
  private relayCapturing = false;
  private relayPending: Array<{ n: number; a: string }> = [];
  private relayInFlight = false;
  private relayFailures = 0;
  private relayRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private frameCounter = 0;
  private directTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: SenderDeps) {
    this.deps = resolvePeerDeps(options);
    const stored = options.stored && (!options.pairing || options.stored.id === options.pairing.id)
      ? options.stored
      : null;
    this.id = options.pairing?.id ?? stored?.id ?? null;
    this.token = stored?.token ?? null;
    this.ice = stored?.ice ?? null;
    if (!this.id) this.state = { ...this.state, phase: "failed", error: "INVALID_LINK" };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): SenderSnapshot {
    return this.state;
  }

  private set(patch: Partial<SenderSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /* --- Person actions ------------------------------------------------------- */

  /** Start (or restart) the microphone. Call from a click handler. */
  start(): Promise<void> {
    if (this.starting) return this.starting;
    // Synchronously, inside the tap: Web Audio must be unlocked by a gesture.
    this.prepareRelay();
    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    if (this.disposed || this.state.phase === "ended" || !this.id) return;
    this.set({ error: null });

    // 1. The microphone, first, while the tap's user activation is fresh.
    if (!this.liveTrack()) {
      if (typeof window !== "undefined" && window.isSecureContext === false) {
        this.set({ phase: "failed", error: "INSECURE_CONTEXT" });
        return;
      }
      const getUserMedia =
        this.options.getUserMedia ??
        (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia
          ? (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints)
          : null);
      if (!getUserMedia || (!this.directAvailable() && !this.relayCapture)) {
        this.set({ phase: "failed", error: "UNSUPPORTED" });
        return;
      }
      this.set({ phase: "requesting-mic" });
      let stream: MediaStream;
      try {
        stream = await getUserMedia({
          audio: senderAudioConstraints(this.options.voiceProcessing === true),
          video: false,
        });
      } catch (error) {
        this.set({ phase: "failed", error: classifyMediaError(error) });
        return;
      }
      if (this.disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      // Belt and braces: never transmit anything but audio.
      stream.getVideoTracks().forEach((track) => {
        track.stop();
        stream.removeTrack(track);
      });
      this.adoptStream(stream);
    }
    this.wantsMedia = true;

    // 2. Claim the pairing once; a reload reuses the stored credential.
    if (!this.token) {
      const pairing = this.options.pairing;
      if (!pairing) {
        this.set({ phase: "failed", error: "INVALID_LINK" });
        return;
      }
      this.set({ phase: "claiming" });
      try {
        const claimed = await this.options.api.claim(pairing.id, pairing.secret);
        this.token = claimed.senderToken;
        this.ice = claimed.ice;
        this.set({ confirmCode: claimed.confirmCode });
        this.options.saveCredential?.({ id: pairing.id, token: claimed.senderToken, ice: claimed.ice });
      } catch (error) {
        this.releaseStream();
        this.set({ phase: "failed", error: classifyApiError(error) });
        return;
      }
    }

    // 3. Negotiate once the MacBook approves; polling drives the rest.
    this.set({ phase: this.state.phase === "claiming" || this.state.phase === "requesting-mic" ? "awaiting-approval" : this.state.phase });
    this.closePeer();
    this.startHeartbeat();
    this.schedulePoll(0);
  }

  /** Stop the microphone but keep the pairing, so Start can resume it. */
  async stop(reason: "user" | "interrupted" = "user"): Promise<void> {
    this.wantsMedia = false;
    sendControl(this.channel, { t: "stop", reason });
    this.cancelDirectDeadline();
    this.stopRelayCapture();
    this.closePeer();
    this.releaseStream();
    this.cancelRestart();
    if (this.state.phase !== "ended" && this.state.phase !== "failed") {
      this.set({ phase: "stopped", reconnectAttempts: 0 });
    }
    this.postStatus("closed");
  }

  setMuted(muted: boolean) {
    const track = this.liveTrack();
    if (track) track.enabled = !muted;
    this.set({ muted });
    this.sendStatus();
    if (this.relayActive) this.postStatus(this.transportState());
  }

  /** A person-initiated reconnect: fresh peer, same microphone if still live. */
  async reconnect(): Promise<void> {
    this.set({ reconnectAttempts: 0, error: null });
    // A person asking to reconnect gets a fresh try at the direct path; the
    // relay takes over again by itself if that still cannot connect.
    this.leaveRelay();
    this.closePeer();
    await this.start();
  }

  /** Leave the pairing entirely. */
  async leave(): Promise<void> {
    const { id, token } = this;
    await this.stop();
    if (id && token) await this.options.api.end(id, token).catch(() => {});
    this.finish("sender-ended");
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.wantsMedia = false;
    sendControl(this.channel, { t: "stop", reason: "user" });
    this.cancelDirectDeadline();
    this.leaveRelay();
    this.relayCapture?.close();
    this.relayCapture = null;
    this.closePeer();
    this.releaseStream();
    this.cancelRestart();
    if (this.pollTimer) this.deps.clearTimer(this.pollTimer);
    if (this.heartbeatTimer) this.deps.clearTimer(this.heartbeatTimer);
    this.listeners.clear();
  }

  /* --- Media ---------------------------------------------------------------- */

  private liveTrack(): MediaStreamTrack | null {
    const track = this.state.stream?.getAudioTracks()[0];
    return track && track.readyState === "live" ? track : null;
  }

  private adoptStream(stream: MediaStream) {
    this.releaseStream();
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      this.set({ phase: "failed", error: "NO_MICROPHONE" });
      return;
    }
    track.enabled = !this.state.muted;
    track.onmute = () => {
      if (this.liveTrack() !== track) return;
      this.set({ interrupted: true });
      this.sendStatus();
    };
    track.onunmute = () => {
      if (this.liveTrack() !== track) return;
      this.set({ interrupted: false });
      this.sendStatus();
    };
    track.onended = () => {
      // iOS ends the capture for some interruptions (a call answered, the
      // route torn down). Say so and stop cleanly; restarting needs a tap.
      if (this.state.stream?.getAudioTracks()[0] !== track) return;
      void this.stop("interrupted").then(() => this.set({ error: "MIC_INTERRUPTED" }));
    };
    this.set({ stream, trackLabel: track.label, interrupted: false });
  }

  private releaseStream() {
    const stream = this.state.stream;
    if (!stream) return;
    for (const track of stream.getTracks()) {
      track.onmute = null;
      track.onunmute = null;
      track.onended = null;
      track.stop();
    }
    this.set({ stream: null, interrupted: false });
  }

  /* --- Polling -------------------------------------------------------------- */

  private schedulePoll(ms: number) {
    if (this.pollTimer) this.deps.clearTimer(this.pollTimer);
    this.pollTimer = this.deps.setTimer(() => {
      this.pollTimer = null;
      void this.pollOnce();
    }, ms);
  }

  private pollDelay(): number {
    switch (this.state.phase) {
      case "awaiting-approval":
        return POLL_MS.approval;
      case "connecting":
      case "reconnecting":
        return POLL_MS.negotiating;
      default:
        return POLL_MS.steady;
    }
  }

  private async pollOnce() {
    const { id, token } = this;
    if (!id || !token || this.disposed || this.state.phase === "ended") return;
    let failed = false;
    try {
      const view = await this.options.api.poll(id, token, this.cursor);
      await this.serial(() => this.handleView(view));
    } catch (error) {
      if (error instanceof RemoteMicApiError && (error.status === 404 || error.status === 410)) {
        this.finish("expired");
        return;
      }
      if (error instanceof RemoteMicApiError && error.status === 401) {
        // The stored credential belongs to a pairing that no longer knows us.
        this.options.saveCredential?.(null);
        this.finish("expired");
        return;
      }
      failed = true;
    }
    if (!this.disposed && this.snapshot().phase !== "ended") {
      this.schedulePoll(failed ? 2000 : this.pollDelay());
    }
  }

  private serial(work: () => Promise<void>): Promise<void> {
    const next = this.busy.then(work, work);
    this.busy = next.catch(() => {});
    return next;
  }

  private async handleView(view: RemoteMicView) {
    if (view.state === "ended") {
      this.finish(view.endedReason ?? "receiver-ended");
      return;
    }
    if (view.confirmCode && view.confirmCode !== this.state.confirmCode) {
      this.set({ confirmCode: view.confirmCode });
    }
    if (view.state !== "approved") return;

    this.generation = Math.max(this.generation, view.generation);

    if (this.relayActive) {
      // A reload or an earlier relay session left the pairing direct: say relay again.
      if (view.transport !== "relay" && !this.relayInFlight) void this.announceRelay();
      if (this.wantsMedia && this.liveTrack() && !this.relayCapturing) this.startRelayCapture();
      return;
    }
    if (this.wantsMedia && this.liveTrack() && !this.pc) {
      if (this.ice?.forceRelay || !this.directAvailable()) {
        await this.engageRelay();
        return;
      }
      this.armDirectDeadline();
      await this.negotiate(true);
      return;
    }

    const answer = view.description;
    if (this.pc && answer && !this.answerApplied && answer.generation === this.generation && answer.peerId === this.peerId) {
      try {
        await this.pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
        this.answerApplied = true;
        const queued = this.pendingRemote.splice(0);
        for (const candidate of queued) await this.addRemoteCandidate(candidate);
      } catch {
        // A stale or rejected answer; the next restart negotiates afresh.
      }
    }
    for (const candidate of view.candidates) {
      if (candidate.generation !== this.generation) continue;
      if (this.answerApplied) await this.addRemoteCandidate(candidate);
      else this.pendingRemote.push(candidate);
    }
    this.cursor = Math.max(this.cursor, view.cursor);
  }

  /* --- Negotiation ---------------------------------------------------------- */

  private async negotiate(fresh: boolean) {
    const track = this.liveTrack();
    const stream = this.state.stream;
    if (!track || !stream || !this.id || !this.token) return;

    if (fresh || !this.pc) {
      this.closePeer();
      this.pc = this.createPeer();
      this.peerId = randomPeerId();
      // Exactly one track, sent only.
      this.pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
      this.attachChannel(this.pc.createDataChannel("asad-control", { ordered: true }));
    }
    const pc = this.pc!;
    this.generation += 1;
    this.answerApplied = false;
    this.pendingRemote = [];
    this.pendingLocal = [];
    if (this.state.phase !== "reconnecting") this.set({ phase: "connecting" });

    try {
      const offer = await pc.createOffer(fresh ? {} : { iceRestart: true });
      await pc.setLocalDescription(offer);
      await this.options.api.signal(this.token, {
        action: "offer",
        id: this.id,
        sdp: pc.localDescription?.sdp ?? offer.sdp ?? "",
        generation: this.generation,
        peerId: this.peerId!,
      });
      this.flushLocalCandidates();
      this.schedulePoll(POLL_MS.negotiating);
    } catch (error) {
      if (error instanceof RemoteMicApiError && error.code === "STALE_GENERATION") {
        // Someone (a previous load of this page) is ahead; catch up and retry.
        this.generation += 1;
        this.closePeer();
        return;
      }
      if (error instanceof RemoteMicApiError && (error.status === 404 || error.status === 410)) {
        this.finish("expired");
        return;
      }
      this.scheduleRecovery();
    }
  }

  private createPeer(): RTCPeerConnection {
    const pc = this.deps.createPeerConnection(rtcConfiguration(this.ice));
    pc.onicecandidate = (event) => {
      if (this.pc !== pc || !event.candidate?.candidate) return;
      this.pendingLocal.push(event.candidate.toJSON());
      this.scheduleLocalFlush();
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      this.onConnectionState(pc.connectionState);
    };
    return pc;
  }

  private attachChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onopen = () => this.sendStatus();
    channel.onmessage = (event) => {
      if (this.channel !== channel || typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data) as { t?: string };
        if (message.t === "end") {
          void this.stop().then(() => this.finish("receiver-ended"));
        }
      } catch {
        // Ignore malformed control data.
      }
    };
  }

  private scheduleLocalFlush() {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    this.deps.setTimer(() => {
      this.flushScheduled = false;
      this.flushLocalCandidates();
    }, 60);
  }

  private flushLocalCandidates() {
    if (!this.id || !this.token || !this.pc?.localDescription) return;
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

  private async addRemoteCandidate(candidate: SignalCandidate) {
    if (!this.pc || !candidate.candidate) return;
    try {
      await this.pc.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      });
    } catch {
      // One unusable candidate is normal.
    }
  }

  private onConnectionState(state: RTCPeerConnectionState) {
    if (state === "connected") {
      this.cancelRestart();
      this.cancelDirectDeadline();
      this.set({ phase: "connected", reconnectAttempts: 0, error: null, transport: "direct" });
      this.postStatus("connected");
      this.sendStatus();
    } else if (state === "disconnected" || state === "failed") {
      if (!this.wantsMedia) return;
      this.set({ phase: "reconnecting" });
      this.postStatus(state);
      this.scheduleRecovery(state === "failed");
    }
  }

  /**
   * Bounded recovery. Wi-Fi blips are healed by ICE restarts on the same peer
   * (the MacBook's track — and so the live capture — survives them); if those
   * fail, one fresh peer; then a clear failure.
   */
  private scheduleRecovery(immediate = false) {
    if (this.restartTimer || !this.wantsMedia) return;
    const attempt = this.state.reconnectAttempts;
    if (attempt > ICE_RESTART_DELAYS_MS.length) {
      if (this.relayCapture) void this.serial(() => this.engageRelay());
      else this.set({ phase: "failed", error: "ICE_FAILED" });
      return;
    }
    const delay = immediate ? 250 : ICE_RESTART_DELAYS_MS[Math.min(attempt, ICE_RESTART_DELAYS_MS.length - 1)];
    this.restartTimer = this.deps.setTimer(() => {
      this.restartTimer = null;
      if (!this.wantsMedia || this.disposed || this.pc?.connectionState === "connected") return;
      this.set({ reconnectAttempts: attempt + 1, phase: "reconnecting" });
      const fresh = attempt >= ICE_RESTART_DELAYS_MS.length;
      void this.serial(() => this.negotiate(fresh));
      // If this attempt does not connect, try again. A fresh peer needs a
      // full offer/answer round trip through signalling, so give it longer.
      this.restartTimer = this.deps.setTimer(() => {
        this.restartTimer = null;
        if (this.pc?.connectionState !== "connected") this.scheduleRecovery();
      }, fresh ? 15_000 : 8000);
    }, delay);
  }

  private cancelRestart() {
    if (this.restartTimer) this.deps.clearTimer(this.restartTimer);
    this.restartTimer = null;
  }

  /* --- Status --------------------------------------------------------------- */

  private sendStatus() {
    sendControl(this.channel, {
      t: "status",
      micActive: !!this.liveTrack(),
      muted: this.state.muted,
      interrupted: this.state.interrupted,
    });
  }

  private postStatus(connection: RTCPeerConnectionState) {
    if (!this.id || !this.token) return;
    void this.options.api
      .signal(this.token, {
        action: "status",
        id: this.id,
        connection,
        micActive: !!this.liveTrack(),
        muted: this.state.muted,
      })
      .catch(() => {});
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) this.deps.clearTimer(this.heartbeatTimer);
    this.heartbeatTimer = this.deps.setTimer(() => {
      this.heartbeatTimer = null;
      if (this.disposed || this.state.phase === "ended") return;
      this.postStatus(this.transportState());
      this.startHeartbeat();
    }, HEARTBEAT_MS);
  }

  /* --- Server relay fallback ------------------------------------------------ */

  private directAvailable(): boolean {
    return !!this.options.createPeerConnection || typeof RTCPeerConnection === "function";
  }

  private prepareRelay() {
    if (this.relayCapture || this.disposed) return;
    const factory = this.options.createRelayCapture === undefined ? createBrowserRelayCapture : this.options.createRelayCapture;
    if (!factory) return;
    try {
      this.relayCapture = factory();
    } catch {
      this.relayCapture = null;
    }
  }

  private transportState(): RTCPeerConnectionState {
    if (this.relayActive) {
      // A stopped microphone must keep reading "closed": the computer pauses on it.
      if (!this.wantsMedia) return "closed";
      return this.relayCapturing && this.state.phase === "connected" ? "connected" : "connecting";
    }
    return this.pc?.connectionState ?? "new";
  }

  private armDirectDeadline() {
    if (this.directTimer || !this.relayCapture) return;
    this.directTimer = this.deps.setTimer(() => {
      this.directTimer = null;
      if (!this.wantsMedia || this.disposed || this.pc?.connectionState === "connected") return;
      void this.serial(() => this.engageRelay());
    }, this.options.relayFallbackMs ?? DEFAULT_RELAY_FALLBACK_MS);
  }

  private cancelDirectDeadline() {
    if (this.directTimer) this.deps.clearTimer(this.directTimer);
    this.directTimer = null;
  }

  /** No direct path: send audio through the ASAD server instead. */
  private async engageRelay() {
    if (this.relayActive || !this.wantsMedia || this.disposed || !this.id || !this.token) return;
    if (this.pc?.connectionState === "connected") return;
    if (!this.relayCapture) {
      this.set({ phase: "failed", error: "ICE_FAILED" });
      return;
    }
    this.cancelDirectDeadline();
    this.cancelRestart();
    this.closePeer();
    this.relayActive = true;
    this.relayFailures = 0;
    this.set({ phase: "connecting", transport: "relay", reconnectAttempts: 0 });
    await this.announceRelay();
    if (this.relayActive && this.wantsMedia && this.liveTrack()) this.startRelayCapture();
  }

  private async announceRelay() {
    if (!this.id || !this.token) return;
    try {
      await this.options.api.signal(this.token, { action: "transport", id: this.id, mode: "relay" });
    } catch (error) {
      if (error instanceof RemoteMicApiError && (error.status === 404 || error.status === 410)) this.finish("expired");
      // Otherwise the next poll sees transport !== "relay" and announces again.
    }
  }

  private startRelayCapture() {
    const stream = this.state.stream;
    if (!this.relayCapture || !stream || this.relayCapturing) return;
    this.relayCapturing = true;
    this.relayPending = [];
    this.relayCapture.start(stream, (frame) => this.queueRelayFrame(frame));
  }

  private stopRelayCapture() {
    if (!this.relayCapturing) return;
    this.relayCapturing = false;
    this.relayCapture?.stop();
    this.relayPending = [];
    if (this.relayRetryTimer) this.deps.clearTimer(this.relayRetryTimer);
    this.relayRetryTimer = null;
  }

  /** Back to direct (a person pressed Reconnect, or the pairing ended). */
  private leaveRelay() {
    this.stopRelayCapture();
    this.relayActive = false;
    this.relayInFlight = false;
    this.relayFailures = 0;
  }

  private queueRelayFrame(frame: Uint8Array) {
    if (!this.relayCapturing) return;
    this.relayPending.push({ n: this.frameCounter, a: bytesToBase64(frame) });
    this.frameCounter += 1;
    if (this.relayPending.length > MAX_PENDING_FRAMES) {
      this.relayPending.splice(0, this.relayPending.length - MAX_PENDING_FRAMES);
    }
    if (!this.relayInFlight && !this.relayRetryTimer) void this.flushRelay();
  }

  private async flushRelay(): Promise<void> {
    const { id, token } = this;
    if (!id || !token || !this.relayCapturing || this.relayInFlight) return;
    const batch = this.relayPending.splice(0, MAX_RELAY_FRAMES_PER_POST);
    if (batch.length === 0) return;
    this.relayInFlight = true;
    try {
      await this.options.api.relaySend(id, token, batch);
      this.relayInFlight = false;
      this.relayFailures = 0;
      if (this.relayCapturing && this.state.phase !== "connected") {
        this.set({ phase: "connected", error: null, reconnectAttempts: 0, transport: "relay" });
        this.postStatus("connected");
      }
    } catch (error) {
      this.relayInFlight = false;
      if (error instanceof RemoteMicApiError && (error.status === 404 || error.status === 410)) {
        this.finish("expired");
        return;
      }
      if (error instanceof RemoteMicApiError && error.status === 401) {
        this.options.saveCredential?.(null);
        this.finish("expired");
        return;
      }
      if (error instanceof RemoteMicApiError && error.status === 409) {
        // The pairing is not (yet) in relay mode on the server; say so again.
        void this.announceRelay();
      }
      this.relayFailures += 1;
      if (this.relayFailures >= RELAY_FAILURES_BEFORE_REPORT && this.state.phase === "connected") {
        this.set({ phase: "reconnecting" });
      }
      // Keep the newest audio for the retry; the queue cap drops the oldest.
      this.relayPending.unshift(...batch.slice(-MAX_PENDING_FRAMES));
      if (this.relayPending.length > MAX_PENDING_FRAMES) {
        this.relayPending.splice(0, this.relayPending.length - MAX_PENDING_FRAMES);
      }
      const delay = Math.min(4000, 500 * 2 ** Math.min(3, this.relayFailures - 1));
      this.relayRetryTimer = this.deps.setTimer(() => {
        this.relayRetryTimer = null;
        void this.flushRelay();
      }, delay);
      return;
    }
    if (this.relayPending.length) void this.flushRelay();
  }

  /** Test/diagnostic hook: lose the peer abruptly, as a dropped network would. */
  simulateNetworkDrop() {
    if (!this.pc) return;
    const pc = this.pc;
    pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      // Already closed.
    }
    this.pc = null;
    this.channel = null;
    this.set({ phase: "reconnecting", reconnectAttempts: ICE_RESTART_DELAYS_MS.length });
    this.scheduleRecovery(true);
  }

  private closePeer() {
    const pc = this.pc;
    this.pc = null;
    this.peerId = null;
    this.answerApplied = false;
    this.pendingRemote = [];
    this.pendingLocal = [];
    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onmessage = null;
      this.channel = null;
    }
    if (pc) {
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // Already closed.
      }
    }
  }

  private finish(reason: RemoteMicEndReason) {
    if (this.state.phase === "ended") return;
    this.wantsMedia = false;
    this.cancelDirectDeadline();
    this.leaveRelay();
    this.relayCapture?.close();
    this.relayCapture = null;
    this.closePeer();
    this.releaseStream();
    this.cancelRestart();
    if (this.pollTimer) this.deps.clearTimer(this.pollTimer);
    if (this.heartbeatTimer) this.deps.clearTimer(this.heartbeatTimer);
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.options.saveCredential?.(null);
    this.set({
      phase: "ended",
      endedReason: reason,
      error: reason === "rejected" ? "REJECTED" : reason === "expired" ? "EXPIRED" : this.state.error,
    });
  }
}

export function classifyMediaError(error: unknown): SenderErrorCode {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "PERMISSION_DENIED";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
    return "NO_MICROPHONE";
  }
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "MIC_BUSY";
  return "UNSUPPORTED";
}

export function classifyApiError(error: unknown): SenderErrorCode {
  if (error instanceof RemoteMicApiError) {
    if (error.code === "ALREADY_CLAIMED") return "ALREADY_CLAIMED";
    if (error.code === "EXPIRED" || error.status === 404 || error.status === 410) return "EXPIRED";
    if (error.status === 403 || error.code === "INVALID_REQUEST") return "INVALID_LINK";
    if (error.status === 429) return "RATE_LIMITED";
  }
  return "SIGNALING_UNAVAILABLE";
}
