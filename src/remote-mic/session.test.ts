import { describe, expect, it } from "vitest";
import {
  ENDED_RETENTION_MS,
  MAX_CANDIDATES_PER_ROLE,
  MAX_SESSION_MS,
  PAIRED_IDLE_TTL_MS,
  PAIRING_WINDOW_MS,
  type SignalRequest,
} from "./protocol";
import {
  applyClaim,
  applySignal,
  endPairing,
  hashSecret,
  isExpired,
  newPairing,
  roleForToken,
  viewFor,
  type RemoteMicRecord,
} from "./session";

const T0 = 1_800_000_000_000;
const OFFER_SDP = "v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const ANSWER_SDP = "v=0\r\no=- 3 4 IN IP4 0.0.0.0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";

function claimed() {
  const created = newPairing(T0);
  const claim = applyClaim(created.record, created.pairingSecret, T0 + 1000);
  if (!claim.ok) throw new Error("claim failed");
  return { ...created, senderToken: claim.value.senderToken, code: claim.value.confirmCode };
}

function approved() {
  const pairing = claimed();
  const result = applySignal(pairing.record, "receiver", { action: "approve", id: pairing.record.id }, T0 + 2000);
  expect(result.ok).toBe(true);
  return pairing;
}

const offer = (record: RemoteMicRecord, generation = 1, peerId = "peer-aaaaaaaa", sdp = OFFER_SDP): SignalRequest => ({
  action: "offer",
  id: record.id,
  sdp,
  generation,
  peerId,
});

describe("pairing creation", () => {
  it("issues unguessable credentials and stores only their hashes", () => {
    const { record, receiverToken, pairingSecret } = newPairing(T0);
    expect(record.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(receiverToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(pairingSecret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const serialised = JSON.stringify(record);
    expect(serialised).not.toContain(receiverToken);
    expect(serialised).not.toContain(pairingSecret);
    expect(record.receiverTokenHash).toBe(hashSecret("receiver", receiverToken));
    expect(record.state).toBe("waiting");
  });

  it("gives an unclaimed QR only the short pairing window", () => {
    const { record } = newPairing(T0);
    expect(record.expiresAt).toBe(T0 + PAIRING_WINDOW_MS);
    expect(isExpired(record, T0 + PAIRING_WINDOW_MS - 1)).toBe(false);
    expect(isExpired(record, T0 + PAIRING_WINDOW_MS)).toBe(true);
  });

  it("never issues the same id or secret twice", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newPairing(T0).record.id));
    expect(ids.size).toBe(200);
  });
});

describe("claiming (pairing authentication)", () => {
  it("accepts the right secret exactly once and makes the QR single-use", () => {
    const { record, pairingSecret } = newPairing(T0);
    const first = applyClaim(record, pairingSecret, T0 + 10);
    expect(first.ok).toBe(true);
    expect(record.state).toBe("claimed");
    expect(record.pairingSecretHash).toBeNull();
    expect(record.confirmCode).toMatch(/^\d{4}$/);

    const second = applyClaim(record, pairingSecret, T0 + 20);
    expect(second).toMatchObject({ ok: false, status: 409, code: "ALREADY_CLAIMED" });
  });

  it("refuses a wrong secret without consuming the pairing", () => {
    const { record, pairingSecret } = newPairing(T0);
    const wrong = applyClaim(record, "A".repeat(32), T0 + 10);
    expect(wrong).toMatchObject({ ok: false, status: 403, code: "UNAUTHORIZED" });
    expect(record.state).toBe("waiting");
    expect(applyClaim(record, pairingSecret, T0 + 20).ok).toBe(true);
  });

  it("refuses an expired pairing link", () => {
    const { record, pairingSecret } = newPairing(T0);
    expect(applyClaim(record, pairingSecret, T0 + PAIRING_WINDOW_MS + 1)).toMatchObject({
      ok: false,
      status: 410,
      code: "EXPIRED",
    });
  });

  it("maps each token to exactly one role and rejects anything else", () => {
    const { record, receiverToken, senderToken } = claimed();
    expect(roleForToken(record, receiverToken)).toBe("receiver");
    expect(roleForToken(record, senderToken)).toBe("sender");
    expect(roleForToken(record, undefined)).toBeNull();
    expect(roleForToken(record, "nope")).toBeNull();
    expect(roleForToken(record, "x".repeat(500))).toBeNull();
  });
});

describe("role enforcement", () => {
  it("only the MacBook can approve or reject, and only a claimed pairing", () => {
    const pairing = claimed();
    const id = pairing.record.id;
    expect(applySignal(pairing.record, "sender", { action: "approve", id }, T0)).toMatchObject({
      ok: false,
      code: "FORBIDDEN_ROLE",
    });
    expect(applySignal(pairing.record, "receiver", { action: "approve", id }, T0).ok).toBe(true);
    expect(pairing.record.state).toBe("approved");
    // Idempotent.
    expect(applySignal(pairing.record, "receiver", { action: "approve", id }, T0).ok).toBe(true);
  });

  it("cannot approve when no phone has claimed", () => {
    const { record } = newPairing(T0);
    expect(applySignal(record, "receiver", { action: "approve", id: record.id }, T0)).toMatchObject({
      ok: false,
      code: "INVALID_STATE",
    });
  });

  it("rejecting ends the pairing for good", () => {
    const pairing = claimed();
    applySignal(pairing.record, "receiver", { action: "reject", id: pairing.record.id }, T0);
    expect(pairing.record.state).toBe("ended");
    expect(pairing.record.endedReason).toBe("rejected");
  });

  it("refuses media negotiation before approval", () => {
    const pairing = claimed();
    expect(applySignal(pairing.record, "sender", offer(pairing.record), T0)).toMatchObject({
      ok: false,
      code: "NOT_APPROVED",
    });
  });

  it("the phone offers and the MacBook answers — never the reverse", () => {
    const pairing = approved();
    expect(applySignal(pairing.record, "receiver", offer(pairing.record), T0)).toMatchObject({
      ok: false,
      code: "FORBIDDEN_ROLE",
    });
    expect(applySignal(pairing.record, "sender", offer(pairing.record), T0).ok).toBe(true);
    const answer: SignalRequest = {
      action: "answer",
      id: pairing.record.id,
      sdp: ANSWER_SDP,
      generation: 1,
      peerId: "peer-aaaaaaaa",
    };
    expect(applySignal(pairing.record, "sender", answer, T0)).toMatchObject({ ok: false, code: "FORBIDDEN_ROLE" });
    expect(applySignal(pairing.record, "receiver", answer, T0).ok).toBe(true);
  });
});

describe("signalling state transitions", () => {
  it("a newer generation replaces the previous negotiation and its candidates", () => {
    const pairing = approved();
    const { record } = pairing;
    applySignal(record, "sender", offer(record, 1), T0);
    applySignal(record, "sender", {
      action: "candidates",
      id: record.id,
      generation: 1,
      candidates: [{ candidate: "candidate:1 1 udp 1 192.0.2.1 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 }],
    }, T0);
    expect(record.candidates.sender).toHaveLength(1);

    expect(applySignal(record, "sender", offer(record, 2, "peer-bbbbbbbb"), T0).ok).toBe(true);
    expect(record.generation).toBe(2);
    expect(record.offer?.peerId).toBe("peer-bbbbbbbb");
    expect(record.candidates.sender).toHaveLength(0);
    expect(record.answer).toBeNull();
  });

  it("refuses stale generations and conflicting offers, accepts identical retries", () => {
    const pairing = approved();
    const { record } = pairing;
    applySignal(record, "sender", offer(record, 2), T0);
    expect(applySignal(record, "sender", offer(record, 1), T0)).toMatchObject({ ok: false, code: "STALE_GENERATION" });
    expect(applySignal(record, "sender", offer(record, 2), T0).ok).toBe(true);
    expect(applySignal(record, "sender", offer(record, 2, "peer-aaaaaaaa", `${OFFER_SDP}a=x\r\n`), T0)).toMatchObject({
      ok: false,
      code: "STALE_GENERATION",
    });
  });

  it("refuses an answer for a replaced offer", () => {
    const pairing = approved();
    const { record } = pairing;
    applySignal(record, "sender", offer(record, 3), T0);
    expect(
      applySignal(record, "receiver", { action: "answer", id: record.id, sdp: ANSWER_SDP, generation: 2, peerId: "peer-aaaaaaaa" }, T0),
    ).toMatchObject({ ok: false, code: "STALE_GENERATION" });
  });
});

describe("ICE candidate handling", () => {
  it("assigns increasing sequence numbers and shows each side only the other's", () => {
    const pairing = approved();
    const { record } = pairing;
    applySignal(record, "sender", offer(record, 1), T0);
    const add = (role: "sender" | "receiver", text: string) =>
      applySignal(record, role, {
        action: "candidates",
        id: record.id,
        generation: 1,
        candidates: [{ candidate: text, sdpMid: "0", sdpMLineIndex: 0 }],
      }, T0);
    add("sender", "candidate:s1");
    add("receiver", "candidate:r1");
    add("sender", "candidate:s2");

    const receiverView = viewFor(record, "receiver", 0);
    expect(receiverView.candidates.map((c) => c.candidate)).toEqual(["candidate:s1", "candidate:s2"]);
    expect(receiverView.description?.type).toBe("offer");

    const later = viewFor(record, "receiver", receiverView.candidates[0].seq);
    expect(later.candidates.map((c) => c.candidate)).toEqual(["candidate:s2"]);

    const senderView = viewFor(record, "sender", 0);
    expect(senderView.candidates.map((c) => c.candidate)).toEqual(["candidate:r1"]);
    expect(senderView.description).toBeNull();
  });

  it("refuses candidates for another generation and bounds their number", () => {
    const pairing = approved();
    const { record } = pairing;
    applySignal(record, "sender", offer(record, 1), T0);
    expect(
      applySignal(record, "sender", { action: "candidates", id: record.id, generation: 2, candidates: [{ candidate: "c", sdpMid: null, sdpMLineIndex: null }] }, T0),
    ).toMatchObject({ ok: false, code: "STALE_GENERATION" });

    const many = Array.from({ length: 16 }, (_, i) => ({ candidate: `candidate:${i}`, sdpMid: "0", sdpMLineIndex: 0 }));
    let refused = false;
    for (let i = 0; i < 4; i += 1) {
      const result = applySignal(record, "sender", { action: "candidates", id: record.id, generation: 1, candidates: many }, T0);
      if (!result.ok) {
        expect(result.code).toBe("TOO_MANY_CANDIDATES");
        refused = true;
      }
    }
    expect(refused).toBe(true);
    expect(record.candidates.sender.length).toBeLessThanOrEqual(MAX_CANDIDATES_PER_ROLE);
  });

  it("drops SDP and candidates once the MacBook reports the peer connected", () => {
    const pairing = approved();
    const { record } = pairing;
    applySignal(record, "sender", offer(record, 1), T0);
    applySignal(record, "receiver", { action: "status", id: record.id, connection: "connected", micActive: true, muted: false }, T0);
    expect(record.offer).toBeNull();
    expect(record.answer).toBeNull();
    expect(record.candidates).toEqual({ sender: [], receiver: [] });
    expect(record.generation).toBe(1);
  });
});

describe("expiry and cleanup", () => {
  it("approved pairings stay alive while heartbeating, then expire when idle", () => {
    const pairing = approved();
    const { record } = pairing;
    expect(record.expiresAt).toBe(T0 + 2000 + PAIRED_IDLE_TTL_MS);
    const later = T0 + 2000 + PAIRED_IDLE_TTL_MS - 1000;
    applySignal(record, "sender", { action: "status", id: record.id, connection: "connected", micActive: true, muted: false }, later);
    expect(record.expiresAt).toBe(later + PAIRED_IDLE_TTL_MS);
    expect(isExpired(record, later + PAIRED_IDLE_TTL_MS)).toBe(true);
  });

  it("has a hard ceiling however busy", () => {
    const pairing = approved();
    expect(isExpired(pairing.record, T0 + MAX_SESSION_MS)).toBe(true);
  });

  it("refuses signalling on an expired pairing and marks it ended", () => {
    const pairing = approved();
    const { record } = pairing;
    const result = applySignal(record, "sender", offer(record), T0 + MAX_SESSION_MS + 1);
    expect(result).toMatchObject({ ok: false, status: 410, code: "EXPIRED" });
    expect(record.state).toBe("ended");
    expect(record.endedReason).toBe("expired");
  });

  it("ending clears negotiation data and keeps the record only briefly", () => {
    const pairing = approved();
    const { record } = pairing;
    applySignal(record, "sender", offer(record), T0);
    endPairing(record, "receiver-ended", T0 + 5000);
    expect(record.state).toBe("ended");
    expect(record.offer).toBeNull();
    expect(record.expiresAt).toBe(T0 + 5000 + ENDED_RETENTION_MS);
    expect(applySignal(record, "sender", offer(record, 2), T0 + 6000)).toMatchObject({ ok: false, code: "EXPIRED" });
    expect(viewFor(record, "sender", 0)).toMatchObject({ state: "ended", endedReason: "receiver-ended" });
  });

  it("views never include credentials or the confirm code before a claim", () => {
    const { record } = newPairing(T0);
    const view = viewFor(record, "receiver", 0);
    expect(view.confirmCode).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/Hash/);
  });
});
