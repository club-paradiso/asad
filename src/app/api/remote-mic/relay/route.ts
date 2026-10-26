/**
 * Server relay for Remote Microphone audio — the fallback transport.
 *
 *   POST /api/remote-mic/relay              phone appends µ-law frames
 *   GET  /api/remote-mic/relay?id=&after=   computer reads frames after a cursor
 *
 * Used only when WebRTC cannot find a path between the two devices (phone on
 * mobile data, guest Wi-Fi with client isolation, no TURN relay configured).
 * Each request is authorised by the pairing-scoped role token AND checked
 * against the pairing's state in one atomic store command: only the approved
 * phone may write, only the computer that opened the pairing may read, and
 * only while the phone has switched the pairing to relay.
 *
 * Nothing here is logged. Frames are bounded in number (~12 s), expire a
 * minute after the last write and are deleted when the pairing ends.
 */
import {
  MAX_RELAY_BODY_BYTES,
  RELAY_READ_COUNT,
  isPairingId,
  isRelayCursor,
  relayPostSchema,
  type RelayReadResponse,
} from "@/remote-mic/protocol";
import {
  availableStore,
  guardRemoteMic,
  relayLimits,
  remoteMicError,
  remoteMicJson,
  storeUnavailable,
  tokenFrom,
} from "@/remote-mic/server";
import type { RelayAppendResult } from "@/remote-mic/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function refused(kind: Exclude<RelayAppendResult, "ok">) {
  if (kind === "not-found") return remoteMicError(404, "NOT_FOUND", "This pairing has expired or does not exist.");
  if (kind === "unauthorized") return remoteMicError(401, "UNAUTHORIZED", "Pairing authorisation required.");
  return remoteMicError(409, "INVALID_STATE", "This pairing is not using the server relay.");
}

export async function POST(request: Request) {
  const token = tokenFrom(request);
  const guarded = await guardRemoteMic(request, {
    limits: relayLimits(request, token),
    maxBodyBytes: MAX_RELAY_BODY_BYTES,
    shared: false,
  });
  if (!guarded.ok) return guarded.response;
  if (!token) return remoteMicError(401, "UNAUTHORIZED", "Pairing authorisation required.");

  const parsed = relayPostSchema.safeParse(guarded.body);
  if (!parsed.success) return remoteMicError(400, "INVALID_REQUEST", "Invalid relay frames.");

  const available = availableStore();
  if (!available.ok) return available.response;

  try {
    const result = await available.store.relayAppend(parsed.data.id, token, parsed.data.frames);
    if (result !== "ok") return refused(result);
    return remoteMicJson({ ok: true });
  } catch {
    return storeUnavailable();
  }
}

export async function GET(request: Request) {
  const token = tokenFrom(request);
  const guarded = await guardRemoteMic(request, { limits: relayLimits(request, token), shared: false });
  if (!guarded.ok) return guarded.response;
  if (!token) return remoteMicError(401, "UNAUTHORIZED", "Pairing authorisation required.");

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const after = url.searchParams.get("after") ?? "";
  if (!isPairingId(id) || !isRelayCursor(after)) return remoteMicError(400, "INVALID_REQUEST", "Invalid relay read.");

  const available = availableStore();
  if (!available.ok) return available.response;

  try {
    const result = await available.store.relayRead(id, token, after, RELAY_READ_COUNT);
    if (result.kind !== "ok") return refused(result.kind);
    const cursor = result.frames.length ? result.frames[result.frames.length - 1].id : after;
    return remoteMicJson({ frames: result.frames, cursor } satisfies RelayReadResponse);
  } catch {
    return storeUnavailable();
  }
}
