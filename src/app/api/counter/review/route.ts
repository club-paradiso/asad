/**
 * POST /api/counter/review — a staff member's explicit decision on one turn.
 *
 *   confirmed  the staff member has checked this turn (optionally: which of
 *              the ambiguity candidates the visitor confirmed)
 *   rejected   the staff member judges this translation/interpretation wrong
 *   cleared    withdraw an earlier decision
 *
 * Host capability only. This is the ONLY way a "reviewed by a person" state
 * can enter the system; nothing automatic writes `staffReview`. It records a
 * decision about a translation turn, never an administrative decision about
 * the visitor.
 */
import { NextResponse } from "next/server";
import { counterReviewSchema } from "@/lib/schema";
import { counterStore } from "@/counter/store";
import { normaliseCode } from "@/counter/codes";
import { counterTokenFrom, participantForToken } from "@/counter/access";
import { findConcept } from "@/counter/admin/registry";
import type { CounterMessage } from "@/counter/types";
import { clientAddress, limiterFor } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024;

export async function POST(request: Request) {
  const limit = limiterFor("counter").check(`counterReview:${clientAddress(request)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Slow down and try again shortly." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  }
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const parsed = counterReviewSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const code = normaliseCode(parsed.data.code);
  if (!code) return NextResponse.json({ error: "Invalid code." }, { status: 400 });
  const { messageId, decision, conceptId } = parsed.data;
  if (conceptId && !findConcept(conceptId)) {
    return NextResponse.json({ error: "Unknown concept." }, { status: 400 });
  }

  const token = counterTokenFrom(request);
  let rejection: NextResponse | null = null;
  let updated: CounterMessage | undefined;

  const session = await counterStore().update(code, (s) => {
    rejection = null;
    if (participantForToken(s, token) !== "host") {
      rejection = NextResponse.json({ error: "Staff authorisation required." }, { status: 401 });
      return false;
    }
    const message = s.messages.find((m) => m.id === messageId);
    if (!message || message.status !== "done") {
      rejection = NextResponse.json({ error: "Message not found." }, { status: 404 });
      return false;
    }
    // A concept can only be confirmed if the layer offered it as a candidate:
    // staff confirm what the visitor said, they do not attach new procedures.
    if (
      conceptId &&
      !message.analysis?.ambiguities.some((finding) =>
        finding.candidates.some((candidate) => candidate.conceptId === conceptId),
      )
    ) {
      rejection = NextResponse.json({ error: "Concept was not a candidate." }, { status: 400 });
      return false;
    }
    if (decision === "cleared") {
      delete message.staffReview;
    } else {
      message.staffReview = {
        decision,
        ...(decision === "confirmed" && conceptId ? { conceptId } : {}),
        at: Date.now(),
      };
    }
    updated = { ...message };
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found or expired." }, { status: 404 });
  }
  if (rejection) return rejection;
  return NextResponse.json({ message: updated });
}
