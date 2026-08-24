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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = createCounterSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!isSupportedLanguage(parsed.data.hostLang)) {
    return NextResponse.json({ error: "Unsupported language." }, { status: 400 });
  }

  const session = counterStore().create(parsed.data);
  return NextResponse.json({ session: toView(session) }, { status: 201 });
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
  const existing = store.get(code);
  if (!existing) {
    return NextResponse.json(
      { error: "That code is not active. Ask the staff member for a new one." },
      { status: 404 },
    );
  }

  // A second scanner must not silently join someone else's consultation — but
  // a visitor correcting a mis-tapped language is far more likely than a
  // hijack, so the door only closes once the visitor has actually said
  // something. After that a different language claim is a different person.
  const guestHasSpoken = existing.messages.some((m) => m.from === "guest");
  if (guestHasSpoken && existing.guestLang !== parsed.data.guestLang) {
    return NextResponse.json(
      { error: "This session already has a visitor." },
      { status: 409 },
    );
  }

  const session = store.update(code, (s) => {
    s.guestLang = parsed.data.guestLang;
    s.guestJoinedAt ??= Date.now();
    s.state = "active";
  });

  return NextResponse.json({ session: toView(session!) });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = normaliseCode(url.searchParams.get("code") ?? "");
  if (!code) return NextResponse.json({ error: "Invalid code." }, { status: 400 });

  const since = Number(url.searchParams.get("since") ?? "0");
  const session = counterStore().get(code);
  if (!session) {
    return NextResponse.json({ error: "Session not found or expired." }, { status: 404 });
  }

  return NextResponse.json(
    { session: toView(session, Number.isFinite(since) ? since : 0) },
    // Never cached: a stale poll is a message the other person thinks you saw.
    { headers: { "cache-control": "no-store" } },
  );
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const code = normaliseCode(url.searchParams.get("code") ?? "");
  if (!code) return NextResponse.json({ error: "Invalid code." }, { status: 400 });

  // Deleted outright, not marked ended — nothing about a counter conversation
  // should outlive it on the server.
  const existed = counterStore().end(code);
  return NextResponse.json({ ended: existed });
}
