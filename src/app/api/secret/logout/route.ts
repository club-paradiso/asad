import { NextResponse } from "next/server";
import { ACCESS_COOKIE, SESSION_COOKIE, isSameOrigin } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true }, {
    headers: { "cache-control": "no-store" },
  });
  for (const name of [ACCESS_COOKIE, SESSION_COOKIE]) {
    response.cookies.set(name, "", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
    });
  }
  return response;
}
