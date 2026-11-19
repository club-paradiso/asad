import { NextResponse } from "next/server";
import { z } from "zod";
import { clientAddress, isSameOrigin, readJsonBody } from "@/lib/guard";
import { RequestRateLimiter } from "@/lib/rate-limit";
import {
  NOTICE_COUNTER_MAX, NOTICE_COUNTER_MIN, NOTICE_IDS, intakeStore, isStaff, validCode,
  type IntakeNotice,
} from "@/intake/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The visitor screen polls every ~2.5 s; keyed by desk code so desks behind one office IP do not share a budget.
const readLimit = new RequestRateLimiter({ limit: 60, windowMs: 60_000 });
const writeLimit = new RequestRateLimiter({ limit: 60, windowMs: 60_000 });
const noStore = { "cache-control": "no-store, max-age=0" };
const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: noStore });

const schema = z.object({
  code: z.string().length(10),
  // null clears the visitor screen.
  id: z.enum(NOTICE_IDS).nullable(),
  counter: z.number().int().min(NOTICE_COUNTER_MIN).max(NOTICE_COUNTER_MAX).optional(),
}).strict().refine(v => (v.id === "counter") === (v.counter !== undefined));

function parseCode(request: Request): string {
  try { return new URL(request.url).searchParams.get("code")?.trim().toUpperCase() ?? ""; }
  catch { return ""; }
}

/** Visitor screen: which fixed phrase (if any) the desk is showing. The desk code is the capability. */
export async function GET(request: Request) {
  const code = parseCode(request);
  if (!validCode(code)) return fail(400, "Invalid desk code.");
  if (!readLimit.check("notice:" + code).allowed) return fail(429, "Too many polls.");
  const store = intakeStore();
  if (!store) return fail(503, "실시간 접수 저장소가 연결되지 않았습니다.");
  try {
    const s = await store.read(code);
    if (!s) return fail(404, "Session not found.");
    return NextResponse.json({ notice: s.notice ?? null, seq: s.noticeSeq ?? 0 }, { headers: noStore });
  } catch { return fail(503, "Notice unavailable."); }
}

/** Staff desk: show a fixed phrase on the visitor screen, or clear it. Only ids travel, never free text. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail(403, "Invalid origin.");
  const supplied = request.headers.get("x-asad-intake-staff-token");
  if (!supplied) return fail(401, "Staff session capability required.");
  if (!writeLimit.check("notice-set:" + clientAddress(request)).allowed) return fail(429, "Too many updates.");
  const body = await readJsonBody(request, 256);
  if (!body.ok) return fail(body.status, body.error);
  const parsed = schema.safeParse(body.value);
  if (!parsed.success || !validCode(parsed.data.code)) return fail(400, "Invalid notice.");
  const { code, id, counter } = parsed.data;
  const store = intakeStore();
  if (!store) return fail(503, "실시간 접수 저장소가 연결되지 않았습니다.");
  try {
    const current = await store.read(code);
    if (!current) return fail(404, "Session not found.");
    if (!isStaff(current, supplied)) return fail(403, "Invalid staff capability.");
    const updated = await store.modify(code, s => {
      const n = (s.noticeSeq ?? 0) + 1;
      s.noticeSeq = n;
      if (id === null) { delete s.notice; return; }
      const notice: IntakeNotice = { id, n, at: Date.now() };
      if (counter !== undefined) notice.counter = counter;
      s.notice = notice;
    });
    if (!updated) return fail(404, "Session not found.");
    return NextResponse.json({ ok: true, notice: updated.notice ?? null, seq: updated.noticeSeq ?? 0 },
      { headers: noStore });
  } catch { return fail(503, "안내 문구를 보내지 못했습니다."); }
}
