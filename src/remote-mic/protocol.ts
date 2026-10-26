/**
 * Remote Microphone signalling protocol.
 *
 * Shared by the route handlers and both browsers. The iPhone is only an audio
 * capture device: it negotiates one WebRTC audio track with the MacBook and
 * never sees the recogniser, its credentials, or the transcript.
 *
 * Two transports, tried in this order:
 *
 *  1. "direct" — WebRTC. Audio travels peer to peer (or through a configured
 *     TURN relay) over DTLS-SRTP. Only signalling touches ASAD's servers.
 *  2. "relay"  — when no WebRTC path exists (phone on LTE, guest Wi-Fi with
 *     client isolation, no TURN configured), the phone posts short compressed
 *     audio frames over HTTPS and the computer reads them back. Frames sit in
 *     the shared store only briefly (bounded length, short TTL) and are deleted
 *     when the pairing ends. Higher delay than direct, but it works on any
 *     network that can reach the ASAD site.
 */
import { z } from "zod";

/** Capability header carrying a role token. Never a cookie, so never CSRF-able. */
export const REMOTE_MIC_TOKEN_HEADER = "x-asad-remote-mic-token";

/** How long a QR code may wait for a phone, and that phone for approval. */
export const PAIRING_WINDOW_MS = 5 * 60_000;
/** An approved pairing expires this long after both peers stop heartbeating. */
export const PAIRED_IDLE_TTL_MS = 10 * 60_000;
/** Hard ceiling on any one pairing, however busy. One long service plus margin. */
export const MAX_SESSION_MS = 6 * 60 * 60_000;
/** An ended pairing is kept briefly so the other peer learns why it ended. */
export const ENDED_RETENTION_MS = 2 * 60_000;

/** ICE candidates kept per role per negotiation. A healthy LAN needs a handful. */
export const MAX_CANDIDATES_PER_ROLE = 40;
/** An audio-only offer with a data channel is ~3–6 KB; anything far beyond is not ours. */
export const MAX_SDP_LENGTH = 16_000;
export const MAX_CANDIDATE_LENGTH = 1_024;
/** Bounded signalling request size. */
export const MAX_SIGNAL_BODY_BYTES = 24 * 1024;

export type RemoteMicRole = "receiver" | "sender";

export type RemoteMicTransport = "direct" | "relay";

/* --- Server relay (fallback transport) ------------------------------------ */
/** Relay audio: 16 kHz mono G.711 µ-law, one frame per this many ms. */
export const RELAY_SAMPLE_RATE = 16_000;
export const RELAY_FRAME_MS = 300;
export const RELAY_FRAME_BYTES = (RELAY_SAMPLE_RATE * RELAY_FRAME_MS) / 1000;
/** base64 of one frame, with headroom for a slightly long frame. */
export const MAX_RELAY_FRAME_B64 = Math.ceil((RELAY_FRAME_BYTES * 2) / 3) * 4;
/** Frames per POST: a phone catching up after a slow request sends a batch. */
export const MAX_RELAY_FRAMES_PER_POST = 10;
export const MAX_RELAY_BODY_BYTES = 96 * 1024;
/** Frames kept in the store (~12 s). Older audio is useless for live work. */
export const RELAY_MAX_STORED_FRAMES = 40;
/** Frames vanish this long after the last write, whatever happens to the pairing. */
export const RELAY_TTL_MS = 60_000;
/** Frames returned per read. */
export const RELAY_READ_COUNT = 20;

export type RemoteMicState =
  /** QR shown on the Mac; no phone yet. */
  | "waiting"
  /** A phone presented the pairing secret and is awaiting the Mac's approval. */
  | "claimed"
  /** The Mac approved this phone; WebRTC negotiation may proceed. */
  | "approved"
  | "ended";

export type RemoteMicEndReason =
  | "receiver-ended"
  | "sender-ended"
  | "rejected"
  | "expired";

/** Machine-readable error codes. The browsers map each to a sentence. */
export type RemoteMicErrorCode =
  | "NOT_FOUND"
  | "EXPIRED"
  | "UNAUTHORIZED"
  | "FORBIDDEN_ROLE"
  | "ALREADY_CLAIMED"
  | "NOT_APPROVED"
  | "INVALID_STATE"
  | "STALE_GENERATION"
  | "TOO_MANY_CANDIDATES"
  | "INVALID_REQUEST"
  | "SHARED_STORE_REQUIRED"
  | "STORE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "ACCESS_REQUIRED"
  | "CROSS_ORIGIN";

export interface SignalDescription {
  type: "offer" | "answer";
  sdp: string;
  /** Increments on every renegotiation (ICE restart or new sender peer). */
  generation: number;
  /** Random per sender RTCPeerConnection. A new id means "replace the peer". */
  peerId: string;
}

export interface SignalCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  generation: number;
  seq: number;
}

/** Coarse peer status. Flags only — no audio, no transcript, no addresses. */
export interface PeerStatus {
  connection: "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";
  micActive: boolean;
  muted: boolean;
  updatedAt: number;
}

export interface RemoteMicIceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface RemoteMicIceConfig {
  iceServers: RemoteMicIceServer[];
  iceTransportPolicy: "all" | "relay";
  /** Whether a TURN relay is configured. Shown in diagnostics; never the credential. */
  turn: boolean;
  /**
   * Skip WebRTC and use the ASAD server relay straight away. A deployment
   * switch (REMOTE_MIC_TRANSPORT=relay), used for networks known to block
   * WebRTC and for testing the fallback.
   */
  forceRelay?: boolean;
}

/** What one role may see of a pairing. */
export interface RemoteMicView {
  id: string;
  role: RemoteMicRole;
  state: RemoteMicState;
  expiresAt: number;
  /** Shown on both screens once a phone has claimed, so the Mac can approve the right one. */
  confirmCode: string | null;
  generation: number;
  /** Receiver sees the offer; sender sees the answer. */
  description: SignalDescription | null;
  /** The OTHER role's candidates for the current generation with seq > since. */
  candidates: SignalCandidate[];
  /** Highest candidate seq included, for the next poll's `since`. */
  cursor: number;
  peer: PeerStatus | null;
  endedReason: RemoteMicEndReason | null;
  /** Which transport the phone is using. "relay" means: read /api/remote-mic/relay. */
  transport: RemoteMicTransport;
}

export interface RelayFrame {
  /** Store-assigned, increasing. The next read's `after`. */
  id: string;
  /** Sender's frame counter: a gap means frames were dropped. */
  n: number;
  /** base64 µ-law audio. */
  a: string;
}

export interface RelayReadResponse {
  frames: RelayFrame[];
  cursor: string;
}

export interface CreatePairingResponse {
  id: string;
  receiverToken: string;
  pairingSecret: string;
  expiresAt: number;
  ice: RemoteMicIceConfig;
}

export interface ClaimPairingResponse {
  senderToken: string;
  confirmCode: string;
  expiresAt: number;
  ice: RemoteMicIceConfig;
}

/* -------------------------------------------------------------------------- */
/* Identifiers                                                                 */
/* -------------------------------------------------------------------------- */

/** 16 random bytes, base64url. An address, not a secret. */
const pairingId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
/** 24 random bytes, base64url. The one-time credential in the QR code. */
const pairingSecret = z.string().regex(/^[A-Za-z0-9_-]{32}$/);

export const isPairingId = (value: unknown): value is string => pairingId.safeParse(value).success;

export const claimSchema = z.object({ id: pairingId, secret: pairingSecret }).strict();

const generation = z.number().int().min(1).max(10_000);
const peerId = z.string().regex(/^[A-Za-z0-9_-]{8,32}$/);

/**
 * SDP accepted by the signalling routes. Audio-only by construction: an offer
 * carrying a video m-line is refused here as well as by the receiver, so a
 * modified client cannot turn the pairing into a camera.
 */
const sdp = z
  .string()
  .min(10)
  .max(MAX_SDP_LENGTH)
  .refine((value) => value.startsWith("v=0"), "not an SDP")
  .refine((value) => !/^m=video/m.test(value), "video is not accepted");

const candidate = z
  .object({
    candidate: z.string().max(MAX_CANDIDATE_LENGTH),
    sdpMid: z.string().max(32).nullable(),
    sdpMLineIndex: z.number().int().min(0).max(16).nullable(),
  })
  .strict();

const connection = z.enum(["new", "connecting", "connected", "disconnected", "failed", "closed"]);

export const signalSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), id: pairingId }).strict(),
  z.object({ action: z.literal("reject"), id: pairingId }).strict(),
  z.object({ action: z.literal("offer"), id: pairingId, sdp, generation, peerId }).strict(),
  z.object({ action: z.literal("answer"), id: pairingId, sdp, generation, peerId }).strict(),
  z
    .object({
      action: z.literal("candidates"),
      id: pairingId,
      generation,
      candidates: z.array(candidate).min(1).max(16),
    })
    .strict(),
  z.object({ action: z.literal("transport"), id: pairingId, mode: z.enum(["direct", "relay"]) }).strict(),
  z
    .object({
      action: z.literal("status"),
      id: pairingId,
      connection,
      micActive: z.boolean(),
      muted: z.boolean(),
    })
    .strict(),
]);

export type SignalRequest = z.infer<typeof signalSchema>;

const base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const relayPostSchema = z
  .object({
    id: pairingId,
    frames: z
      .array(
        z
          .object({
            n: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
            a: base64.min(4).max(MAX_RELAY_FRAME_B64),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_RELAY_FRAMES_PER_POST),
  })
  .strict();

export type RelayPostRequest = z.infer<typeof relayPostSchema>;

/** A store cursor: "" (from the start) or a Redis stream id. */
export const isRelayCursor = (value: unknown): value is string =>
  typeof value === "string" && (value === "" || /^\d{1,16}-\d{1,10}$/.test(value));

/* -------------------------------------------------------------------------- */
/* Pairing link                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The pairing link carries its credential in the URL FRAGMENT. Browsers never
 * send a fragment to a server, so the secret does not appear in access logs,
 * proxies or a Referer header; only the phone's own script reads it.
 */
export function pairingUrl(origin: string, id: string, secret: string): string {
  return `${origin.replace(/\/$/, "")}/remote-mic#p=${id}.${secret}`;
}

export function parsePairingFragment(hash: string): { id: string; secret: string } | null {
  const raw = hash.replace(/^#/, "");
  const params = new URLSearchParams(raw);
  const value = params.get("p");
  if (!value) return null;
  const [id, secret, extra] = value.split(".");
  if (extra !== undefined) return null;
  const parsed = claimSchema.safeParse({ id, secret });
  return parsed.success ? parsed.data : null;
}
