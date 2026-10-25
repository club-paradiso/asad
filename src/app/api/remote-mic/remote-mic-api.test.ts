import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as CREATE, GET as POLL, DELETE as END } from "./session/route";
import { POST as CLAIM } from "./claim/route";
import { POST as SIGNAL } from "./signal/route";
import { ACCESS_COOKIE, SESSION_COOKIE, __resetGuards, issueSessionToken } from "@/lib/guard";
import { __resetEnvCache } from "@/lib/env";
import { __setRemoteMicStore, createMemoryRemoteMicStore } from "@/remote-mic/store";
import { REMOTE_MIC_TOKEN_HEADER, type CreatePairingResponse, type RemoteMicView } from "@/remote-mic/protocol";

/**
 * The Remote Microphone signalling API, through its route handlers — the part
 * a browser actually touches: status codes, error codes, who may do what.
 */
const ORIGIN = "http://localhost";
const OFFER_SDP = "v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const ANSWER_SDP = "v=0\r\no=- 3 4 IN IP4 0.0.0.0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
let address = 0;

const operator = (extra: Record<string, string> = {}) => ({
  origin: ORIGIN,
  cookie: `${SESSION_COOKIE}=${issueSessionToken()}`,
  "content-type": "application/json",
  "x-forwarded-for": `10.0.0.${address}`,
  ...extra,
});

const create = (headers: Record<string, string> = operator()) =>
  CREATE(new Request(`${ORIGIN}/api/remote-mic/session`, { method: "POST", headers, body: "{}" }));

const claim = (body: unknown, headers: Record<string, string> = {}) =>
  CLAIM(
    new Request(`${ORIGIN}/api/remote-mic/claim`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": `10.0.1.${address}`, ...headers },
      body: JSON.stringify(body),
    }),
  );

const poll = (id: string, token: string | undefined, since = 0) =>
  POLL(
    new Request(`${ORIGIN}/api/remote-mic/session?id=${id}&since=${since}`, {
      headers: token ? { [REMOTE_MIC_TOKEN_HEADER]: token } : {},
    }),
  );

const signal = (token: string | undefined, body: unknown, headers: Record<string, string> = {}) =>
  SIGNAL(
    new Request(`${ORIGIN}/api/remote-mic/signal`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        ...(token ? { [REMOTE_MIC_TOKEN_HEADER]: token } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );

async function pairApproved() {
  const created = (await (await create()).json()) as CreatePairingResponse;
  const claimed = (await (await claim({ id: created.id, secret: created.pairingSecret })).json()) as {
    senderToken: string;
    confirmCode: string;
  };
  const approved = await signal(created.receiverToken, { action: "approve", id: created.id });
  expect(approved.status).toBe(200);
  return { created, claimed };
}

beforeEach(() => {
  address += 1;
  delete process.env.APP_ACCESS_KEY;
  delete process.env.SESSION_SECRET;
  delete process.env.VERCEL;
  __resetEnvCache();
  __resetGuards();
  __setRemoteMicStore(createMemoryRemoteMicStore());
});

afterEach(() => {
  __setRemoteMicStore(null);
  delete process.env.APP_ACCESS_KEY;
  delete process.env.VERCEL;
  __resetEnvCache();
  __resetGuards();
});

describe("POST /api/remote-mic/session — Mac creates a pairing", () => {
  it("returns a pairing with credentials and STUN-only ICE by default", async () => {
    const response = await create();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as CreatePairingResponse;
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.receiverToken).toBeTruthy();
    expect(body.pairingSecret).toBeTruthy();
    expect(body.ice.turn).toBe(false);
  });

  it("refuses cross-origin creation", async () => {
    const response = await create(operator({ origin: "https://evil.example" }));
    expect(response.status).toBe(403);
  });

  it("is behind the private-deployment access gate", async () => {
    process.env.APP_ACCESS_KEY = "a-private-deployment-key";
    __resetEnvCache();
    __resetGuards();
    expect((await create()).status).toBe(401);
    const admitted = await create(
      operator({
        cookie: `${SESSION_COOKIE}=${issueSessionToken()}; ${ACCESS_COOKIE}=a-private-deployment-key`,
      }),
    );
    expect(admitted.status).toBe(201);
  });

  it("refuses to pretend on Vercel without a shared signalling store", async () => {
    process.env.VERCEL = "1";
    const response = await create();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "SHARED_STORE_REQUIRED" });
  });

  it("is rate limited", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) statuses.push((await create()).status);
    expect(statuses).toContain(429);
  });
});

describe("POST /api/remote-mic/claim — phone joins", () => {
  it("accepts the QR secret once and issues a sender token", async () => {
    const created = (await (await create()).json()) as CreatePairingResponse;
    const first = await claim({ id: created.id, secret: created.pairingSecret });
    expect(first.status).toBe(200);
    const body = (await first.json()) as { senderToken: string; confirmCode: string };
    expect(body.confirmCode).toMatch(/^\d{4}$/);

    // Session takeover: a second device with the same QR is refused.
    const second = await claim({ id: created.id, secret: created.pairingSecret });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "ALREADY_CLAIMED" });
  });

  it("rejects invalid and unknown pairings without detail", async () => {
    const created = (await (await create()).json()) as CreatePairingResponse;
    expect((await claim({ id: created.id, secret: "x".repeat(32) })).status).toBe(403);
    expect((await claim({ id: "Z".repeat(22), secret: "x".repeat(32) })).status).toBe(404);
    expect((await claim({ id: "bad", secret: "bad" })).status).toBe(400);
  });

  it("does not need (or grant) the app access key", async () => {
    process.env.APP_ACCESS_KEY = "a-private-deployment-key";
    __resetEnvCache();
    __resetGuards();
    const created = (await (
      await create(
        operator({ cookie: `${SESSION_COOKIE}=${issueSessionToken()}; ${ACCESS_COOKIE}=a-private-deployment-key` }),
      )
    ).json()) as CreatePairingResponse;
    const claimed = await claim({ id: created.id, secret: created.pairingSecret });
    expect(claimed.status).toBe(200);
    expect(claimed.headers.get("set-cookie")).toBeNull();
    // A sender token cannot open a pairing (an operator action).
    const { senderToken } = (await claimed.json()) as { senderToken: string };
    const attempt = await create({ origin: ORIGIN, "content-type": "application/json", [REMOTE_MIC_TOKEN_HEADER]: senderToken });
    expect(attempt.status).toBe(401);
  });
});

describe("signalling — roles, approval and negotiation", () => {
  it("runs the full exchange: approve → offer → answer → candidates → connected", async () => {
    const { created, claimed } = await pairApproved();
    const id = created.id;

    // Mac sees the code it must match before approving.
    const receiverView = (await (await poll(id, created.receiverToken)).json()) as RemoteMicView;
    expect(receiverView).toMatchObject({ state: "approved", role: "receiver", confirmCode: claimed.confirmCode });

    expect((await signal(claimed.senderToken, { action: "offer", id, sdp: OFFER_SDP, generation: 1, peerId: "peer-aaaaaaaa" })).status).toBe(200);
    expect(
      (await signal(claimed.senderToken, {
        action: "candidates",
        id,
        generation: 1,
        candidates: [{ candidate: "candidate:1 1 udp 2122260223 192.0.2.10 54400 typ host", sdpMid: "0", sdpMLineIndex: 0 }],
      })).status,
    ).toBe(200);

    const withOffer = (await (await poll(id, created.receiverToken)).json()) as RemoteMicView;
    expect(withOffer.description).toMatchObject({ type: "offer", generation: 1, peerId: "peer-aaaaaaaa" });
    expect(withOffer.candidates).toHaveLength(1);

    expect((await signal(created.receiverToken, { action: "answer", id, sdp: ANSWER_SDP, generation: 1, peerId: "peer-aaaaaaaa" })).status).toBe(200);
    const senderView = (await (await poll(id, claimed.senderToken)).json()) as RemoteMicView;
    expect(senderView.description).toMatchObject({ type: "answer", generation: 1 });

    await signal(created.receiverToken, { action: "status", id, connection: "connected", micActive: true, muted: false });
    const settled = (await (await poll(id, created.receiverToken)).json()) as RemoteMicView;
    expect(settled.description).toBeNull();
    expect(settled.candidates).toEqual([]);
  });

  it("enforces roles: the phone cannot approve, the Mac cannot offer", async () => {
    const created = (await (await create()).json()) as CreatePairingResponse;
    const { senderToken } = (await (await claim({ id: created.id, secret: created.pairingSecret })).json()) as {
      senderToken: string;
    };
    const selfApprove = await signal(senderToken, { action: "approve", id: created.id });
    expect(selfApprove.status).toBe(403);
    await signal(created.receiverToken, { action: "approve", id: created.id });
    const macOffer = await signal(created.receiverToken, { action: "offer", id: created.id, sdp: OFFER_SDP, generation: 1, peerId: "peer-aaaaaaaa" });
    expect(macOffer.status).toBe(403);
  });

  it("refuses media negotiation until the Mac approves", async () => {
    const created = (await (await create()).json()) as CreatePairingResponse;
    const { senderToken } = (await (await claim({ id: created.id, secret: created.pairingSecret })).json()) as {
      senderToken: string;
    };
    const early = await signal(senderToken, { action: "offer", id: created.id, sdp: OFFER_SDP, generation: 1, peerId: "peer-aaaaaaaa" });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ code: "NOT_APPROVED" });
  });

  it("rejects missing, wrong and cross-pairing tokens", async () => {
    const a = await pairApproved();
    address += 1;
    const b = await pairApproved();
    expect((await poll(a.created.id, undefined)).status).toBe(401);
    expect((await poll(a.created.id, "not-a-token")).status).toBe(401);
    // B's receiver token is useless against pairing A.
    expect((await poll(a.created.id, b.created.receiverToken)).status).toBe(401);
    expect((await signal(b.claimed.senderToken, { action: "status", id: a.created.id, connection: "connected", micActive: true, muted: false })).status).toBe(401);
    expect((await signal(undefined, { action: "approve", id: a.created.id })).status).toBe(401);
  });

  it("refuses a video offer at the schema", async () => {
    const { created, claimed } = await pairApproved();
    const response = await signal(claimed.senderToken, {
      action: "offer",
      id: created.id,
      sdp: `${OFFER_SDP}m=video 9 UDP/TLS/RTP/SAVPF 96\r\n`,
      generation: 1,
      peerId: "peer-aaaaaaaa",
    });
    expect(response.status).toBe(400);
  });

  it("refuses cross-origin signalling", async () => {
    const { created, claimed } = await pairApproved();
    const response = await signal(claimed.senderToken, { action: "approve", id: created.id }, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
  });

  it("refuses oversized signalling bodies", async () => {
    const { created, claimed } = await pairApproved();
    const response = await SIGNAL(
      new Request(`${ORIGIN}/api/remote-mic/signal`, {
        method: "POST",
        headers: { origin: ORIGIN, [REMOTE_MIC_TOKEN_HEADER]: claimed.senderToken },
        body: JSON.stringify({ action: "offer", id: created.id, sdp: `v=0${"a".repeat(40_000)}`, generation: 1, peerId: "peer-aaaaaaaa" }),
      }),
    );
    expect(response.status).toBe(413);
  });
});

describe("DELETE /api/remote-mic/session — termination and revocation", () => {
  it("either side ends it; the other learns why; tokens then stop working", async () => {
    const { created, claimed } = await pairApproved();
    const ended = await END(
      new Request(`${ORIGIN}/api/remote-mic/session?id=${created.id}`, {
        method: "DELETE",
        headers: { [REMOTE_MIC_TOKEN_HEADER]: created.receiverToken },
      }),
    );
    expect(await ended.json()).toEqual({ ended: true });

    const senderView = (await (await poll(created.id, claimed.senderToken)).json()) as RemoteMicView;
    expect(senderView).toMatchObject({ state: "ended", endedReason: "receiver-ended" });
    const offer = await signal(claimed.senderToken, { action: "offer", id: created.id, sdp: OFFER_SDP, generation: 1, peerId: "peer-aaaaaaaa" });
    expect(offer.status).toBe(410);
  });

  it("refuses to end someone else's pairing", async () => {
    const { created } = await pairApproved();
    const response = await END(
      new Request(`${ORIGIN}/api/remote-mic/session?id=${created.id}`, {
        method: "DELETE",
        headers: { [REMOTE_MIC_TOKEN_HEADER]: "forged" },
      }),
    );
    expect(response.status).toBe(401);
  });
});
