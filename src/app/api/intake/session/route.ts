import { NextResponse } from "next/server";
import { z } from "zod";
import { clientAddress, isSameOrigin, readJsonBody } from "@/lib/guard";
import { RequestRateLimiter } from "@/lib/rate-limit";
import {
  intakeStore, isStaff, publicEntries, validCode,
  type Verification, type Ticket,
} from "@/intake/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createLimit = new RequestRateLimiter({ limit: 6, windowMs: 60_000 });
const pollLimit = new RequestRateLimiter({ limit: 120, windowMs: 60_000 });
const mutateLimit = new RequestRateLimiter({ limit: 30, windowMs: 60_000 });
const noStore = { "cache-control": "no-store, max-age=0" };

const failure = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: noStore });
const noBackend = () =>
  failure(503, "공유 저장소가 필요합니다. 기존 ASAD Upstash Redis 설정을 확인해 주세요.");

function token(request: Request): string | null {
  return request.headers.get("x-asad-intake-staff-token");
}
function parseCode(request: Request): string {
  try { return new URL(request.url).searchParams.get("code")?.trim().toUpperCase() ?? ""; }
  catch { return ""; }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return failure(403, "Invalid request origin.");
  const attempt = createLimit.check("create:" + clientAddress(request));
  if (!attempt.allowed) return failure(429, "Too many sessions.");
  const store = intakeStore();
  if (!store) return noBackend();
  try {
    const { session, staffToken } = await store.create();
    return NextResponse.json({
      code: session.code,
      staffToken,
      expiresAt: session.expiresAt,
    }, { status: 201, headers: noStore });
  } catch {
    return failure(503, "접수 세션을 시작할 수 없습니다.");
  }
}

export async function GET(request: Request) {
  const code = parseCode(request);
  if (!validCode(code)) return failure(400, "Invalid desk code.");
  const supplied = token(request);
  if (!supplied) return failure(401, "Staff session capability required.");
  const attempt = pollLimit.check("poll:" + supplied.slice(0, 80));
  if (!attempt.allowed) return failure(429, "Too many polls.");
  const store = intakeStore();
  if (!store) return noBackend();
  try {
    const session = await store.read(code);
    if (!session) return failure(404, "Session not found.");
    if (!isStaff(session, supplied)) return failure(403, "Invalid staff capability.");
    return NextResponse.json({
      code, expiresAt: session.expiresAt, entries: publicEntries(session),
      live: session.live ?? null,
    }, { headers: noStore });
  } catch { return failure(503, "접수 상태를 확인할 수 없습니다."); }
}

const markSchema = z.object({
  code: z.string().length(10),
  seq: z.number().int().min(1).max(10_000),
  verification: z.enum(["unchecked", "confirmed", "unclear", "exempt"]).optional(),
  ticket: z.enum(["pending", "held", "issued"]).optional(),
}).strict().refine(v => v.verification !== undefined || v.ticket !== undefined);

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return failure(403, "Invalid request origin.");
  const supplied = token(request);
  if (!supplied) return failure(401, "Staff session capability required.");
  const attempt = mutateLimit.check("mark:" + clientAddress(request));
  if (!attempt.allowed) return failure(429, "Too many updates.");
  const parsedBody = await readJsonBody(request, 1024);
  if (!parsedBody.ok) return failure(parsedBody.status, parsedBody.error);
  const parsed = markSchema.safeParse(parsedBody.value);
  if (!parsed.success || !validCode(parsed.data.code)) return failure(400, "Invalid update.");
  const store = intakeStore();
  if (!store) return noBackend();

  try {
    const current = await store.read(parsed.data.code);
    if (!current) return failure(404, "Session not found.");
    if (!isStaff(current, supplied)) return failure(403, "Invalid staff capability.");

    let outcome: "ok" | "invalid" | "missing" = "missing";
    const updated = await store.modify(parsed.data.code, s => {
      outcome = "missing";
      const entry = s.entries.find(e => e.seq === parsed.data.seq);
      if (!entry) return false;
      const verification: Verification = parsed.data.verification ?? entry.verification;
      const requestedTicket: Ticket = parsed.data.ticket ?? entry.ticket;
      if (requestedTicket === "issued" && verification !== "confirmed" && verification !== "exempt") {
        outcome = "invalid"; return false;
      }
      entry.verification = verification;
      // Reopening a verification automatically removes a previous issued state.
      entry.ticket = verification === "unchecked" || verification === "unclear"
        ? (requestedTicket === "held" ? "held" : "pending")
        : requestedTicket;
      outcome = "ok";
    });
    if (!updated || outcome === "missing") return failure(404, "Request not found.");
    if (outcome === "invalid") return failure(409, "직원 확인 후에만 발권 완료로 표시할 수 있습니다.");
    return NextResponse.json({ ok: true, entries: publicEntries(updated) }, { headers: noStore });
  } catch { return failure(503, "확인 결과를 저장하지 못했습니다."); }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return failure(403, "Invalid request origin.");
  const code = parseCode(request), supplied = token(request);
  if (!validCode(code) || !supplied) return failure(400, "Invalid request.");
  const store = intakeStore();
  if (!store) return noBackend();
  try {
    const session = await store.read(code);
    if (!session) return failure(404, "Session not found.");
    if (!isStaff(session, supplied)) return failure(403, "Invalid staff capability.");
    await store.remove(code);
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch { return failure(503, "접수 세션을 종료하지 못했습니다."); }
}
