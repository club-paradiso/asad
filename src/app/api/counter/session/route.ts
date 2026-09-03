/**
 * Counter session lifecycle.
 *
 *   POST   /api/counter/session          create (host)
 *   PATCH  /api/counter/session          join (guest)
 *   GET    /api/counter/session?code=&since=   poll
 *   DELETE /api/counter/session?code=     end and discard
 *
 * Polling rather than SSE: a counter exchange is turn-taking, so ~1.2s delivery
 * is imperceptible, and polling works on serverless where long-lived
 * connections do not.
 */
import { NextResponse } from "next/server";
import { createCounterSessionSchema, joinCounterSessionSchema } from "@/lib/schema";
import { counterStore } from "@/counter/store";
import { normaliseCode } from "@/counter/codes";
import { isSupportedLanguage } from "@/counter/languages";
import { toView } from "@/counter/types";
import {
  counterTokenFrom,
  issueCounterCapability,
  participantForToken,
} from "@/counter/access";
import { hasAccess } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Only somebody admitted to the deployment can open a paid Counter session.
  // The visitor then enters with the QR code plus a session-scoped capability.
  if (!hasAccess(request)) {
    return NextResponse.json(
      { error: "This deployment is private. Enter the access key to continue." },
      { status: 401 },
    );
  }
  const body = await request.json().catch(() => null);
  const parsed = createCounterSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!isSupportedLanguage(parsed.data.hostLang)) {
    return NextResponse.json({ error: "Unsupported language." }, { status: 400 });
  }

  const store = counterStore();

  // Never hand a staff member a QR code that only exists inside one Vercel
  // function instance. A guest request can land on another instance seconds
  // later and legitimately see no session at all. Local/single-process use may
  // keep the memory store, but Vercel Counter Mode requires shared storage.
  if (process.env.VERCEL === "1" && !store.shared) {
    return NextResponse.json(
      {
        error:
          "QR 세션용 공유 저장소가 연결되지 않았습니다. Vercel 프로젝트에 Upstash Redis를 연결한 뒤 다시 배포해 주세요.",
        errorCode: "COUNTER_SHARED_STORE_REQUIRED",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const host = issueCounterCapability();
  const session = await store.create({ ...parsed.data, hostTokenHash: host.hash });
  return NextResponse.json(
    { session: toView(session, 0, "host"), participantToken: host.token },
    { status: 201 },
  );
}

/** The guest joining. Refuses a second guest rather than letting them in. */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = joinCounterSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const code = normaliseCode(parsed.data.code);
  if (!code) return NextResponse.json({ error: "Invalid code." }, { status: 400 });
  if (!isSupportedLanguage(parsed.data.guestLang)) {
    return NextResponse.json({ error: "Unsupported language." }, { status: 400 });
  }

  const store = counterStore();
  const suppliedToken = counterTokenFrom(request);
  const newGuest = issueCounterCapability();
  let joinedToken = suppliedToken ?? newGuest.token;
  let outcome: "joined" | "conflict" = "conflict";

  // The claim and the language guard live in the atomic store mutation. If two
  // phones scan at once, Redis retries the loser against the winner's new
  // capability and the loser receives 409 instead of overwriting the guest.
  const session = await store.update(code, (s) => {
    outcome = "conflict";
    const role = participantForToken(s, suppliedToken);
    if (!s.guestTokenHash) {
      s.guestTokenHash = newGuest.hash;
      joinedToken = newGuest.token;
    } else if (role !== "guest") {
      return;
    }

    const guestHasSpoken = s.messages.some((message) => message.from === "guest");
    if (guestHasSpoken && s.guestLang !== parsed.data.guestLang) return;

    s.guestLang = parsed.data.guestLang;
    s.guestJoinedAt ??= Date.now();
    s.state = "active";
    outcome = "joined";
  });
  if (!session) {
    return NextResponse.json(
      { error: "That code is not active. Ask the staff member for a new one." },
      { status: 404 },
    );
  }

  if (outcome === "conflict") {
    return NextResponse.json(
      { error: "This session already has a visitor." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    session: toView(session, 0, "guest"),
    participantToken: joinedToken,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = normaliseCode(url.searchParams.get("code") ?? "");
  if (!code) return NextResponse.json({ error: "Invalid code." }, { status: 400 });

  const since = Number(url.searchParams.get("since") ?? "0");
  const session = await counterStore().get(code);
  if (!session) {
    return NextResponse.json({ error: "Session not found or expired." }, { status: 404 });
  }

  const participant = participantForToken(session, counterTokenFrom(request));
  if (!participant) {
    return NextResponse.json({ error: "Session authorisation required." }, { status: 401 });
  }

  return NextResponse.json(
    { session: toView(session, Number.isFinite(since) ? since : 0, participant) },
    // Never cached: a stale poll is a message the other person thinks you saw.
    { headers: { "cache-control": "no-store" } },
  );
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const code = normaliseCode(url.searchParams.get("code") ?? "");
  if (!code) return NextResponse.json({ error: "Invalid code." }, { status: 400 });

  const store = counterStore();
  const session = await store.get(code);
  if (!session) return NextResponse.json({ ended: false });
  if (!participantForToken(session, counterTokenFrom(request))) {
    return NextResponse.json({ error: "Session authorisation required." }, { status: 401 });
  }

  // Deleted outright, not marked ended — nothing about a counter conversation
  // should outlive it on the server beyond the store's delete/TTL semantics.
  const existed = await store.end(code);
  return NextResponse.json({ ended: existed });
}
