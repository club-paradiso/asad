/**
 * A deliberately small in-memory stand-in for RTCPeerConnection, MediaStream
 * and RTCDataChannel, for driving the Remote Microphone state machines in
 * jsdom (which has no WebRTC at all).
 *
 * It proves SIGNALLING and LIFECYCLE behaviour — that the offer, answer and
 * candidates travel the real routes, that peers are replaced rather than
 * doubled, that stop/end tear everything down. It proves nothing about media:
 * that is what the Chromium end-to-end script (`npm run e2e:remote-mic`) is
 * for, with real browser WebRTC and real audio samples.
 */

export class FakeTrack extends EventTarget {
  readonly kind = "audio";
  readonly id = `track-${Math.random().toString(36).slice(2)}`;
  readyState: "live" | "ended" = "live";
  muted = false;
  enabled = true;
  onmute: (() => void) | null = null;
  onunmute: (() => void) | null = null;
  onended: (() => void) | null = null;
  constructor(readonly label = "Fake microphone") {
    super();
  }
  stop() {
    this.readyState = "ended";
  }
  /** The remote end going away: per spec, `ended` fires for remote tracks. */
  endRemotely() {
    if (this.readyState === "ended") return;
    this.readyState = "ended";
    this.onended?.();
  }
  getSettings() {
    return {};
  }
}

export class FakeStream {
  private tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
  }
  getAudioTracks() {
    return [...this.tracks];
  }
  getVideoTracks() {
    return [];
  }
  getTracks() {
    return [...this.tracks];
  }
  removeTrack(track: FakeTrack) {
    this.tracks = this.tracks.filter((item) => item !== track);
  }
}

class FakeChannel {
  readyState: "connecting" | "open" | "closed" = "connecting";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  peer: FakeChannel | null = null;
  send(data: string) {
    if (this.readyState !== "open") throw new Error("channel not open");
    const peer = this.peer;
    queueMicrotask(() => peer?.onmessage?.({ data }));
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
  close() {
    this.readyState = "closed";
  }
}

const peers = new Map<string, FakePeerConnection>();
let nextPeer = 0;

export class FakePeerConnection {
  readonly uid = `p${(nextPeer += 1)}`;
  connectionState: RTCPeerConnectionState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  ontrack: ((event: { track: FakeTrack; streams: FakeStream[] }) => void) | null = null;
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  ondatachannel: ((event: { channel: FakeChannel }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  readonly addedCandidates: string[] = [];
  private remote: FakePeerConnection | null = null;
  private sentTrack: FakeTrack | null = null;
  private remoteTrack: FakeTrack | null = null;
  private channel: FakeChannel | null = null;
  readonly config: RTCConfiguration;

  constructor(config: RTCConfiguration) {
    this.config = config;
    peers.set(this.uid, this);
  }

  addTransceiver(track: FakeTrack) {
    this.sentTrack = track;
    return {};
  }

  createDataChannel() {
    this.channel = new FakeChannel();
    return this.channel;
  }

  async createOffer() {
    return { type: "offer", sdp: `v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fake-peer:${this.uid}\r\n` };
  }

  async createAnswer() {
    return { type: "answer", sdp: `v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fake-peer:${this.uid}\r\n` };
  }

  async setLocalDescription(description: { type: string; sdp: string }) {
    this.localDescription = description;
    queueMicrotask(() =>
      this.onicecandidate?.({
        candidate: {
          candidate: `candidate:${this.uid} 1 udp 2122260223 192.0.2.1 50000 typ host`,
          toJSON: () => ({
            candidate: `candidate:${this.uid} 1 udp 2122260223 192.0.2.1 50000 typ host`,
            sdpMid: "0",
            sdpMLineIndex: 0,
          }),
        },
      }),
    );
  }

  async setRemoteDescription(description: { type: string; sdp: string }) {
    const uid = /a=fake-peer:(\w+)/.exec(description.sdp)?.[1];
    const other = uid ? peers.get(uid) : undefined;
    if (!other) throw new Error("unknown remote peer");
    this.remote = other;
    if (description.type === "answer") {
      other.remote = this;
      // Both ends connect once the offerer has the answer.
      setTimeout(() => FakePeerConnection.connect(this, other), 1);
    }
  }

  async addIceCandidate(candidate: { candidate: string }) {
    this.addedCandidates.push(candidate.candidate);
  }

  async getStats() {
    const report = new Map<string, Record<string, unknown>>();
    report.set("in", { id: "in", type: "inbound-rtp", kind: "audio", packetsReceived: 100, packetsLost: 0, bytesReceived: 4000, jitter: 0.002 });
    return report as unknown as RTCStatsReport;
  }

  close() {
    if (this.connectionState === "closed") return;
    this.connectionState = "closed";
    this.channel?.close();
    this.remoteTrack?.endRemotely();
    const other = this.remote;
    if (other && other.connectionState === "connected") {
      other.connectionState = "disconnected";
      other.onconnectionstatechange?.();
    }
    peers.delete(this.uid);
  }

  /** Offerer `sender`, answerer `receiver`. */
  private static connect(sender: FakePeerConnection, receiver: FakePeerConnection) {
    if (sender.connectionState === "closed" || receiver.connectionState === "closed") return;
    if (sender.sentTrack && !receiver.remoteTrack) {
      receiver.remoteTrack = new FakeTrack("remote");
      receiver.ontrack?.({ track: receiver.remoteTrack, streams: [] });
    }
    if (sender.channel && !receiver.channel) {
      const remoteChannel = new FakeChannel();
      remoteChannel.peer = sender.channel;
      sender.channel.peer = remoteChannel;
      receiver.channel = remoteChannel;
      receiver.ondatachannel?.({ channel: remoteChannel });
      remoteChannel.open();
      sender.channel.open();
    }
    for (const peer of [sender, receiver]) {
      peer.connectionState = "connected";
      peer.onconnectionstatechange?.();
    }
  }

  /** The number of fake peers still open — for leak checks. */
  static openPeers() {
    return [...peers.values()].filter((peer) => peer.connectionState !== "closed").length;
  }
}
