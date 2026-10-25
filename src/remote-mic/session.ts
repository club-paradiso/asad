/**
 * Remote Microphone pairing state machine.
 *
 * Pure functions over a plain record so the rules — who may do what, when a
 * pairing expires, how a renegotiation replaces the last one — are tested
 * without a server, a store or a browser. The store applies them atomically.
 *
 * Every credential is held only as a hash. A leaked record (or Redis dump)
 * cannot be replayed as a receiver, a sender or a fresh claim.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  ENDED_RETENTION_MS,
  MAX_CANDIDATES_PER_ROLE,
  MAX_SESSION_MS,
  PAIRED_IDLE_TTL_MS,
  PAIRING_WINDOW_MS,
  type PeerStatus,
  type RemoteMicEndReason,
  type RemoteMicErrorCode,
  type RemoteMicRole,
  type RemoteMicState,
  type RemoteMicView,
  type SignalCandidate,
  type SignalDescription,
  type SignalRequest,
} from "./protocol";

export interface RemoteMicRecord {
  id: string;
  createdAt: number;
  expiresAt: number;
  state: RemoteMicState;
  receiverTokenHash: string;
  /** Cleared the moment a phone claims: the QR code is single-use. */
  pairingSecretHash: string | null;
  senderTokenHash: string | null;
  confirmCode: string | null;
  generation: number;
  offer: SignalDescription | null;
  answer: SignalDescription | null;
  candidates: { sender: SignalCandidate[]; receiver: SignalCandidate[] };
  nextSeq: number;
  status: { sender: PeerStatus | null; receiver: PeerStatus | null };
  endedReason: RemoteMicEndReason | null;
}

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: RemoteMicErrorCode; error: string };

export const fail = <T = never>(
  status: number,
  code: RemoteMicErrorCode,
  error: string,
): Outcome<T> => ({ ok: false, status, code, error });

/* -------------------------------------------------------------------------- */
/* Credentials                                                                 */
/* -------------------------------------------------------------------------- */

export function hashSecret(kind: "receiver" | "sender" | "pairing", secret: string): string {
  return createHash("sha256").update(`asad/remote-mic/${kind}/v1:${secret}`).digest("base64url");
}

function hashesMatch(a: string, b: string | null): boolean {
  if (!b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Which role a presented token belongs to, if any. Constant-time per comparison. */
export function roleForToken(record: RemoteMicRecord, token: string | undefined): RemoteMicRole | null {
  if (!token || token.length > 128) return null;
  if (hashesMatch(hashSecret("receiver", token), record.receiverTokenHash)) return "receiver";
  if (hashesMatch(hashSecret("sender", token), record.senderTokenHash)) return "sender";
  return null;
}

const token = (bytes: number) => randomBytes(bytes).toString("base64url");

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

export function newPairing(now: number): {
  record: RemoteMicRecord;
  receiverToken: string;
  pairingSecret: string;
} {
  const receiverToken = token(24);
  const pairingSecret = token(24);
  const record: RemoteMicRecord = {
    id: token(16),
    createdAt: now,
    expiresAt: now + PAIRING_WINDOW_MS,
    state: "waiting",
    receiverTokenHash: hashSecret("receiver", receiverToken),
    pairingSecretHash: hashSecret("pairing", pairingSecret),
    senderTokenHash: null,
    confirmCode: null,
    generation: 0,
    offer: null,
    answer: null,
    candidates: { sender: [], receiver: [] },
    nextSeq: 1,
    status: { sender: null, receiver: null },
    endedReason: null,
  };
  return { record, receiverToken, pairingSecret };
}

export const isExpired = (record: RemoteMicRecord, now: number): boolean =>
  now >= record.expiresAt || now >= record.createdAt + MAX_SESSION_MS;

/** Milliseconds the store should keep this record. */
export function retentionMs(record: RemoteMicRecord, now: number): number {
  const until = Math.min(record.expiresAt, record.createdAt + MAX_SESSION_MS);
  return Math.max(1_000, until - now);
}

function touch(record: RemoteMicRecord, now: number) {
  if (record.state === "approved") {
    record.expiresAt = Math.min(record.createdAt + MAX_SESSION_MS, now + PAIRED_IDLE_TTL_MS);
  }
}

/** End a pairing and drop everything negotiation-related straight away. */
export function endPairing(record: RemoteMicRecord, reason: RemoteMicEndReason, now: number) {
  if (record.state === "ended") return;
  record.state = "ended";
  record.endedReason = reason;
  record.pairingSecretHash = null;
  clearNegotiation(record);
  record.expiresAt = now + ENDED_RETENTION_MS;
}

function clearNegotiation(record: RemoteMicRecord) {
  record.offer = null;
  record.answer = null;
  record.candidates = { sender: [], receiver: [] };
}

/** A four-digit code both screens show, so the Mac approves the phone it can see. */
export function confirmCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

/**
 * A phone presents the QR secret. Exactly one phone can ever succeed: the
 * secret hash is cleared on success, so a second scan — or a screenshot of
 * the QR sent elsewhere — can never take the pairing over.
 */
export function applyClaim(
  record: RemoteMicRecord,
  secret: string,
  now: number,
): Outcome<{ senderToken: string; confirmCode: string }> {
  if (record.state === "ended" || isExpired(record, now)) {
    return fail(410, "EXPIRED", "This pairing link has expired.");
  }
  if (record.state !== "waiting" || !record.pairingSecretHash) {
    return fail(409, "ALREADY_CLAIMED", "Another device has already used this pairing link.");
  }
  if (!hashesMatch(hashSecret("pairing", secret), record.pairingSecretHash)) {
    return fail(403, "UNAUTHORIZED", "This pairing link is not valid.");
  }
  const senderToken = token(24);
  const code = confirmCode();
  record.senderTokenHash = hashSecret("sender", senderToken);
  record.pairingSecretHash = null;
  record.confirmCode = code;
  record.state = "claimed";
  return { ok: true, value: { senderToken, confirmCode: code } };
}

/** Apply one signalling action by one authenticated role. */
export function applySignal(
  record: RemoteMicRecord,
  role: RemoteMicRole,
  request: SignalRequest,
  now: number,
): Outcome<null> {
  if (record.state === "ended") {
    return fail(410, "EXPIRED", "This remote microphone connection has ended.");
  }
  if (isExpired(record, now)) {
    endPairing(record, "expired", now);
    return fail(410, "EXPIRED", "This remote microphone connection has expired.");
  }

  switch (request.action) {
    case "approve":
    case "reject": {
      if (role !== "receiver") {
        return fail(403, "FORBIDDEN_ROLE", "Only the MacBook can approve a phone.");
      }
      if (request.action === "approve" && record.state === "approved") return { ok: true, value: null };
      if (record.state !== "claimed") {
        return fail(409, "INVALID_STATE", "There is no phone waiting for approval.");
      }
      if (request.action === "reject") {
        endPairing(record, "rejected", now);
        return { ok: true, value: null };
      }
      record.state = "approved";
      touch(record, now);
      return { ok: true, value: null };
    }

    case "offer": {
      if (role !== "sender") return fail(403, "FORBIDDEN_ROLE", "Only the phone sends an offer.");
      if (record.state !== "approved") {
        return fail(409, "NOT_APPROVED", "The MacBook has not approved this phone yet.");
      }
      if (request.generation < record.generation) {
        return fail(409, "STALE_GENERATION", "A newer connection attempt is already in progress.");
      }
      if (request.generation === record.generation && record.offer) {
        // Idempotent retry of the same offer; anything else is a conflict.
        return record.offer.sdp === request.sdp
          ? { ok: true, value: null }
          : fail(409, "STALE_GENERATION", "This connection attempt already has an offer.");
      }
      record.generation = request.generation;
      clearNegotiation(record);
      record.offer = {
        type: "offer",
        sdp: request.sdp,
        generation: request.generation,
        peerId: request.peerId,
      };
      touch(record, now);
      return { ok: true, value: null };
    }

    case "answer": {
      if (role !== "receiver") return fail(403, "FORBIDDEN_ROLE", "Only the MacBook sends an answer.");
      if (record.state !== "approved") return fail(409, "NOT_APPROVED", "This pairing is not approved.");
      if (!record.offer || request.generation !== record.generation) {
        return fail(409, "STALE_GENERATION", "That offer has been replaced.");
      }
      if (record.answer) {
        return record.answer.sdp === request.sdp
          ? { ok: true, value: null }
          : fail(409, "STALE_GENERATION", "This offer has already been answered.");
      }
      record.answer = {
        type: "answer",
        sdp: request.sdp,
        generation: request.generation,
        peerId: request.peerId,
      };
      touch(record, now);
      return { ok: true, value: null };
    }

    case "candidates": {
      if (record.state !== "approved") return fail(409, "NOT_APPROVED", "This pairing is not approved.");
      if (request.generation !== record.generation) {
        return fail(409, "STALE_GENERATION", "Those candidates belong to a replaced connection attempt.");
      }
      const list = record.candidates[role];
      if (list.length + request.candidates.length > MAX_CANDIDATES_PER_ROLE) {
        return fail(413, "TOO_MANY_CANDIDATES", "Too many network candidates for one connection attempt.");
      }
      for (const item of request.candidates) {
        list.push({ ...item, generation: request.generation, seq: record.nextSeq });
        record.nextSeq += 1;
      }
      touch(record, now);
      return { ok: true, value: null };
    }

    case "status": {
      if (record.state !== "approved" && record.state !== "claimed") {
        return fail(409, "INVALID_STATE", "This pairing is not active.");
      }
      record.status[role] = {
        connection: request.connection,
        micActive: request.micActive,
        muted: request.muted,
        updatedAt: now,
      };
      // Minimise what signalling storage holds: once the MacBook reports the
      // peer connected, the SDP and candidates (which carry network addresses)
      // have done their job. A later ICE restart posts fresh ones.
      if (role === "receiver" && request.connection === "connected") clearNegotiation(record);
      touch(record, now);
      return { ok: true, value: null };
    }
  }
}

/** What `role` is allowed to see. The other side's credentials never appear. */
export function viewFor(record: RemoteMicRecord, role: RemoteMicRole, since: number): RemoteMicView {
  const other: RemoteMicRole = role === "receiver" ? "sender" : "receiver";
  const candidates = record.candidates[other].filter(
    (item) => item.seq > since && item.generation === record.generation,
  );
  const cursor = candidates.reduce((max, item) => Math.max(max, item.seq), since);
  const description = role === "receiver" ? record.offer : record.answer;
  return {
    id: record.id,
    role,
    state: record.state,
    expiresAt: record.expiresAt,
    confirmCode: record.state === "claimed" || record.state === "approved" ? record.confirmCode : null,
    generation: record.generation,
    description,
    candidates,
    cursor,
    peer: record.status[other],
    endedReason: record.endedReason,
  };
}
