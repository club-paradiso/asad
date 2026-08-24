/**
 * GET /api/bible?ref=1%20Peter%202:9 — resolve a Scripture reference.
 *
 * Runs server-side so a Bible API key stays out of the browser. Returns the
 * normalised reference always, and verse text only when the configured
 * provider legally supplied it. It never fails the caller: a dead upstream
 * returns the reference alone, because that is still useful on stage.
 */
import { NextResponse } from "next/server";
import { parseEnglishReference } from "@/interpreter/scripture/detect";
import { resolveBibleProvider } from "@/providers/bible";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("ref")?.trim();
  if (!raw) {
    return NextResponse.json({ error: "Missing ?ref parameter." }, { status: 400 });
  }

  const parsed = parseEnglishReference(raw);
  if (!parsed) {
    return NextResponse.json({ error: `Could not read the reference "${raw}".` }, { status: 400 });
  }

  const { provider, note } = resolveBibleProvider();

  try {
    const reference = await provider.lookup({
      book: parsed.book,
      chapter: parsed.chapter,
      verse: parsed.verse,
      verseEnd: parsed.verseEnd,
      translation: url.searchParams.get("translation") ?? undefined,
    });
    return NextResponse.json({ reference, provider: provider.id, note });
  } catch {
    return NextResponse.json({
      reference: parsed,
      provider: provider.id,
      note: "Lookup failed — showing the reference only.",
      degraded: true,
    });
  }
}
