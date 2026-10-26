/**
 * Remote Microphone pairing lifecycle.
 *
 *   POST   /api/remote-mic/session              MacBook opens a pairing (QR)
 *   GET    /api/remote-mic/session?id=&since=   either peer polls signalling
 *   DELETE /api/remote-mic/session?id=          either peer ends the pairing
 *
 * Polling rather than WebSockets: signalling is a few small messages during a
 * couple of seconds of negotiation, then a slow heartbeat. Short HTTP requests
 * against shared Redis work identically on every serverless instance, and the
 * audio itself never touches these routes — it travels peer to peer.
 */
import { guardInferenceRoute } from "@/lib/guard";
import { isPairingId } from "@/remote-mic/protocol";
import { resolveRemoteMicIceConfig } from "@/remote-mic/ice";
import { endPairing, isExpired, newPairing, roleForToken, viewFor } from "@/remote-mic/session";
import {
  availableStore,
  guardRemoteMic,
  remoteMicError,
  remoteMicJson,
  signalLimits,
  storeUnavailable,
  tokenFrom,
} from "@/remote-mic/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Opening a pairing is an ASAD-operator action: the same access gate,
  // same-origin rule and session token as every other operator route. The
  // phone never needs (and never receives) any of these.
  const guarded = await guardInferenceRoute(request, {
    requireSession: true,
    maxBodyBytes: 256,
    limits: [
      { rule: "remoteMicCreate", by: "session" },
      { rule: "remoteMicCreate", by: "address" },
    ],
  });
  if (!guarded.ok) return guarded.response;

  const available = availableStore();
  if (!available.ok) return available.response;

  const now = Date.now();
  const { record, receiverToken, pairingSecret } = newPairing(now);
  try {
    await available.store.create(record);
  } catch {
    return storeUnavailable();
  }

  return remoteMicJson(
    {
      id: record.id,
      receiverToken,
      pairingSecret,
      expiresAt: record.expiresAt,
      ice: await resolveRemoteMicIceConfig(),
    },
    201,
  );
}

export async function GET(request: Request) {
  const token = tokenFrom(request);
  const guarded = await guardRemoteMic(request, { limits: signalLimits(request, token) });
  if (!guarded.ok) return guarded.response;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!isPairingId(id)) return remoteMicError(400, "INVALID_REQUEST", "Invalid pairing.");
  const sinceRaw = Number(url.searchParams.get("since") ?? "0");
  const since = Number.isSafeInteger(sinceRaw) && sinceRaw >= 0 ? sinceRaw : 0;

  const available = availableStore();
  if (!available.ok) return available.response;

  let record;
  try {
    record = await available.store.get(id);
  } catch {
    return storeUnavailable();
  }
  if (!record) return remoteMicError(404, "NOT_FOUND", "This pairing has expired or does not exist.");

  const role = roleForToken(record, token);
  if (!role) return remoteMicError(401, "UNAUTHORIZED", "Pairing authorisation required.");

  if (record.state !== "ended" && isExpired(record, Date.now())) {
    return remoteMicError(410, "EXPIRED", "This pairing has expired.");
  }
  return remoteMicJson(viewFor(record, role, since));
}

export async function DELETE(request: Request) {
  const token = tokenFrom(request);
  const guarded = await guardRemoteMic(request, { limits: signalLimits(request, token) });
  if (!guarded.ok) return guarded.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!isPairingId(id)) return remoteMicError(400, "INVALID_REQUEST", "Invalid pairing.");

  const available = availableStore();
  if (!available.ok) return available.response;

  try {
    const outcome = await available.store.update(id, (record) => {
      const role = roleForToken(record, token);
      if (!role) return { write: false, result: "unauthorized" as const };
      endPairing(record, role === "receiver" ? "receiver-ended" : "sender-ended", Date.now());
      return { write: true, result: "ended" as const };
    });
    if (!outcome.found) return remoteMicJson({ ended: false });
    if (outcome.result === "unauthorized") {
      return remoteMicError(401, "UNAUTHORIZED", "Pairing authorisation required.");
    }
    // Relay audio has no reason to outlive the pairing, even for its TTL.
    await available.store.relayClear(id).catch(() => {});
    return remoteMicJson({ ended: true });
  } catch {
    return storeUnavailable();
  }
}
