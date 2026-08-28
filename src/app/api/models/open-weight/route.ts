/**
 * GET /api/models/open-weight — free open-weight models worth pinning.
 *
 * Answers the question a deployer actually has: *which open-source model
 * should I put in `OPENROUTER_PRIMARY_MODEL`?* Reading a list in the README
 * cannot answer it, because the set OpenRouter serves free rotates; only
 * asking OpenRouter can.
 *
 * Costs nothing — the catalogue is public and unauthenticated, so unlike the
 * OpenRouter health probe this makes no billed request. It is still same-origin
 * and rate limited, because it reaches a third party on the deployment's
 * behalf.
 */
import { NextResponse } from "next/server";
import { clientAddress, hasAccess, isSameOrigin, limiterFor } from "@/lib/guard";
import { appEnv } from "@/lib/env";
import { freeOpenWeightModels, type OpenWeightSuggestion } from "@/providers/llm/catalogue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface OpenWeightModels {
  /** Where the list came from: a live catalogue read, or the verified floor. */
  source: "openrouter" | "fallback";
  /** Present only when the live read failed, explaining which one this is. */
  reason?: string;
  /** The model this deployment currently sends live turns to. */
  current: { model: string; openWeight: boolean };
  suggestions: OpenWeightSuggestion[];
  /** Copy-paste line for `.env`, so acting on this is one edit. */
  envHint: string;
  checkedAt: string;
}

export async function GET(request: Request) {
  if (!hasAccess(request)) {
    return NextResponse.json({ error: "This deployment is private." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not accepted." }, { status: 403 });
  }
  const verdict = limiterFor("health").check(`models:${clientAddress(request)}`);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "Too many catalogue lookups; try again shortly." },
      { status: 429, headers: { "retry-after": String(verdict.retryAfterSeconds) } },
    );
  }

  const env = appEnv();
  const result = await freeOpenWeightModels();
  const top = result.models[0];

  const payload: OpenWeightModels = {
    source: result.source,
    reason: result.ok ? undefined : result.reason,
    current: {
      model: env.llm.openrouter.primaryModel,
      openWeight: result.models.some((m) => m.id === env.llm.openrouter.primaryModel),
    },
    suggestions: result.models,
    envHint: top ? `OPENROUTER_PRIMARY_MODEL=${top.id}` : "",
    checkedAt: new Date().toISOString(),
  };

  return NextResponse.json(payload);
}
