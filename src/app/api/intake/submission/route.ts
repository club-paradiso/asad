import { NextResponse } from "next/server";
import { z } from "zod";
import { clientAddress, isSameOrigin, readJsonBody } from "@/lib/guard";
import { RequestRateLimiter } from "@/lib/rate-limit";
import {
  INTAKE_MAX_ENTRIES, RESERVATION_NO, intakeStore, validCode, validLanguage,
  type Booking, type IntakeLanguage,
} from "@/intake/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const submissionLimit = new RequestRateLimiter({ limit: 30, windowMs: 60_000 });
const noStore = { "cache-control": "no-store, max-age=0" };
const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: noStore });

const schema = z.object({
  code: z.string().length(10),
  requestId: z.string().uuid(),
  language: z.string().max(5),
  serviceIndex: z.number().int().min(0).max(19),
  booking: z.enum(["yes", "no", "unsure"]),
  // Optional HiKorea visit-reservation number, only meaningful when the visitor says they booked.
  reservationNo: z.string().regex(RESERVATION_NO).optional(),
}).strict().refine(v => v.reservationNo === undefined || v.booking === "yes");

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail(403, "Invalid origin.");
  const rate = submissionLimit.check("submit:" + clientAddress(request));
  if (!rate.allowed) return fail(429, "요청이 너무 많습니다. 직원에게 알려 주세요.");
  const body = await readJsonBody(request, 1024);
  if (!body.ok) return fail(body.status, body.error);
  const parsed = schema.safeParse(body.value);
  if (!parsed.success || !validCode(parsed.data.code) || !validLanguage(parsed.data.language)) {
    return fail(400, "잘못된 접수 요청입니다.");
  }
  const store = intakeStore();
  if (!store) return fail(503, "실시간 접수 저장소가 연결되지 않았습니다.");

  try {
    let seq = 0, full = false;
    const s = await store.modify(parsed.data.code, current => {
      // A network retry with the same requestId does not create duplicate queue entries.
      const old = current.entries.find(e => e.requestId === parsed.data.requestId);
      if (old) { seq = old.seq; return false; }
      if (current.entries.length >= INTAKE_MAX_ENTRIES) { full = true; return false; }
      seq = current.nextSeq++;
      current.entries.push({
        seq, requestId: parsed.data.requestId,
        language: parsed.data.language as IntakeLanguage,
        serviceIndex: parsed.data.serviceIndex,
        booking: parsed.data.booking as Booking,
        ...(parsed.data.reservationNo ? { reservationNo: parsed.data.reservationNo.toUpperCase() } : {}),
        ...(current.station ? { station: current.station } : {}),
        receivedAt: Date.now(),
        verification: "unchecked", ticket: "pending",
      });
    });
    if (!s) return fail(404, "직원 접수 세션이 종료됐습니다. 직원에게 알려 주세요.");
    if (full) return fail(409, "접수 세션이 가득 찼습니다. 직원에게 알려 주세요.");
    if (!seq) return fail(503, "요청을 저장하지 못했습니다.");
    return NextResponse.json({ accepted: true, seq }, { status: 201, headers: noStore });
  } catch { return fail(503, "직원 화면으로 전달하지 못했습니다. 다시 시도해 주세요."); }
}
