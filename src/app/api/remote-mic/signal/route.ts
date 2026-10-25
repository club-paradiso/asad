/**
 * POST /api/remote-mic/signal — one signalling action by one pairing role.
 *
 *   approve / reject   MacBook decides on the phone that claimed the QR
 *   offer / answer     WebRTC session descriptions (audio only)
 *   candidates         trickle ICE, bounded per negotiation
 *   status             coarse connection / mic flags, also the heartbeat
 *
 * Nothing posted here is logged. SDP and candidates are held only until the
 * MacBook reports the connection established, and the whole record expires on
 * its own.
 */
import { MAX_SIGNAL_BODY_BYTES, signalSchema, type RemoteMicView } from "@/remote-mic/protocol";
import { applySignal, roleForToken, viewFor, type Outcome } from "@/remote-mic/session";
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
  const token = tokenFrom(request);
  const guarded = await guardRemoteMic(request, {
    limits: signalLimits(request, token),
    maxBodyBytes: MAX_SIGNAL_BODY_BYTES,
  });
  if (!guarded.ok) return guarded.response;
  if (!token) return remoteMicError(401, "UNAUTHORIZED", "Pairing authorisation required.");

  const parsed = signalSchema.safeParse(guarded.body);
  if (!parsed.success) return remoteMicError(400, "INVALID_REQUEST", "Invalid signalling message.");

  const available = availableStore();
  if (!available.ok) return available.response;

  try {
    type Result =
      | { kind: "unauthorized" }
      | { kind: "applied"; result: Outcome<null>; view: RemoteMicView };
    const outcome = await available.store.update<Result>(parsed.data.id, (record) => {
      const role = roleForToken(record, token);
      if (!role) return { write: false, result: { kind: "unauthorized" } };
      const result = applySignal(record, role, parsed.data, Date.now());
      // An expiry discovered here is itself a state change worth persisting.
      const write = result.ok || record.state === "ended";
      return { write, result: { kind: "applied", result, view: viewFor(record, role, 0) } };
    });
    if (!outcome.found) return remoteMicError(404, "NOT_FOUND", "This pairing has expired or does not exist.");
    const value = outcome.result;
    if (value.kind === "unauthorized") {
      return remoteMicError(401, "UNAUTHORIZED", "Pairing authorisation required.");
    }
    if (!value.result.ok) return remoteMicError(value.result.status, value.result.code, value.result.error);
    // State and expiry only; the caller polls for descriptions and candidates.
    return remoteMicJson({ state: value.view.state, expiresAt: value.view.expiresAt });
  } catch {
    return storeUnavailable();
  }
}
