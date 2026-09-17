import { NextResponse } from "next/server";
import { clientAddress, hasAccess, isSameOrigin, limiterFor } from "@/lib/guard";
import { translateForCounter } from "@/counter/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Temporary fixed-input smoke probe for the real Counter translation path.
 * No request content is accepted, so this cannot be used to translate arbitrary
 * text or expose user data. Remove after the production regression is isolated.
 */
export async function GET(request: Request) {
  if (!hasAccess(request)) {
    return NextResponse.json({ error: "This deployment is private." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not accepted." }, { status: 403 });
  }
  const verdict = limiterFor("health").check(`translation-smoke:${clientAddress(request)}`);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "Translation smoke checks are rate limited." },
      { status: 429, headers: { "retry-after": String(verdict.retryAfterSeconds) } },
    );
  }

  const result = await translateForCounter({
    text: "안녕하세요. 체류기간 연장을 신청하고 싶습니다.",
    sourceLang: "ko-KR",
    targetLang: "en-US",
    recent: [],
    inputMode: "text",
    from: "host",
    profileId: "general",
    forceSensitiveRouting: false,
    routingKey: "health:translation-smoke",
  });

  return NextResponse.json(
    {
      ok: result.ok,
      translation: result.output?.translation,
      confidence: result.output?.confidence,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      error: result.error,
      checkedAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
