import { NextResponse } from "next/server";
import { z } from "zod";
import { clientAddress, isSameOrigin, readJsonBody } from "@/lib/guard";
import { RequestRateLimiter } from "@/lib/rate-limit";
import {
  LIVE_STEPS, intakeStore, validCode, validLanguage,
  type Booking, type IntakeLanguage, type IntakeLive,
} from "@/intake/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The kiosk posts once per screen change, so a visitor tapping quickly stays far below this.
const liveLimit = new RequestRateLimiter({ limit: 120, windowMs: 60_000 });
const noStore = { "cache-control": "no-store, max-age=0" };
const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: noStore });

const schema = z.object({
  code: z.string().length(10),
  step: z.enum(LIVE_STEPS),
  language: z.string().max(5).optional(),
  serviceIndex: z.number().int().min(0).max(19).optional(),
  booking: z.enum(["yes", "no", "unsure"]).optional(),
  seq: z.number().int().min(1).max(10_000).optional(),
  // Client clock-based revision. Optional so an already-loaded older kiosk keeps working.
  rev: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();

/**
 * Visitor screen -> staff mirror. Carries only the same coded choices as a
 * submission (language code, service index, booking answer); never free text.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail(403, "Invalid origin.");
  const rate = liveLimit.check("live:" + clientAddress(request));
  if (!rate.allowed) return fail(429, "Too many updates.");
  const body = await readJsonBody(request, 512);
  if (!body.ok) return fail(body.status, body.error);
  const parsed = schema.safeParse(body.value);
  if (!parsed.success || !validCode(parsed.data.code)) return fail(400, "Invalid live state.");
  const { code, step, language, serviceIndex, booking, seq, rev } = parsed.data;
  if (language !== undefined && !validLanguage(language)) return fail(400, "Invalid live state.");
  const store = intakeStore();
  if (!store) return fail(503, "실시간 접수 저장소가 연결되지 않았습니다.");

  const live: IntakeLive = { step, updatedAt: Date.now() };
  if (language !== undefined) live.language = language as IntakeLanguage;
  if (serviceIndex !== undefined) live.serviceIndex = serviceIndex;
  if (booking !== undefined) live.booking = booking as Booking;
  if (seq !== undefined) live.seq = seq;
  if (rev !== undefined) live.rev = rev;
  try {
    let stale = false;
    const s = await store.modify(code, current => {
      // A slower, older update must never overwrite a newer screen state.
      if (rev !== undefined && current.live?.rev !== undefined && current.live.rev >= rev) {
        stale = true; return false;
      }
      current.live = live;
    });
    if (!s) return fail(404, "Session not found.");
    return NextResponse.json({ ok: true, stale }, { headers: noStore });
  } catch { return fail(503, "Live state unavailable."); }
}
