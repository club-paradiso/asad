/**
 * POST /api/remote-mic/claim — the iPhone presents the QR pairing secret.
 *
 * Deliberately outside the app's access gate: the pairing secret IS the
 * credential, scoped to one pairing, single-use, and short-lived. A phone that
 * succeeds receives a sender token for that pairing and nothing else — it
 * cannot open other pairings, mint recogniser credentials, or reach any paid
 * route. The MacBook must still approve it before any media is negotiated.
 */
import { clientAddress } from "@/lib/guard";
import { claimSchema } from "@/remote-mic/protocol";
import { resolveRemoteMicIceConfig } from "@/remote-mic/ice";
import { applyClaim } from "@/remote-mic/session";
import {
  availableStore,
  guardRemoteMic,
  remoteMicError,
  remoteMicJson,
  storeUnavailable,
} from "@/remote-mic/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guarded = await guardRemoteMic(request, {
    limits: [{ rule: "remoteMicClaim", key: clientAddress(request) }],
    maxBodyBytes: 512,
  });
  if (!guarded.ok) return guarded.response;

  const parsed = claimSchema.safeParse(guarded.body);
  if (!parsed.success) return remoteMicError(400, "INVALID_REQUEST", "This pairing link is not valid.");

  const available = availableStore();
  if (!available.ok) return available.response;

  try {
    const outcome = await available.store.update(parsed.data.id, (record) => {
      const result = applyClaim(record, parsed.data.secret, Date.now());
      return { write: result.ok, result: { result, expiresAt: record.expiresAt } };
    });
    if (!outcome.found) {
      return remoteMicError(404, "NOT_FOUND", "This pairing link has expired or does not exist.");
    }
    const { result, expiresAt } = outcome.result;
    if (!result.ok) return remoteMicError(result.status, result.code, result.error);
    return remoteMicJson({
      senderToken: result.value.senderToken,
      confirmCode: result.value.confirmCode,
      expiresAt,
      ice: await resolveRemoteMicIceConfig(),
    });
  } catch {
    return storeUnavailable();
  }
}
