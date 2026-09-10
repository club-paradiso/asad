import { NextResponse } from "next/server";
import { clientTelemetryBatchSchema } from "@/lib/schema";
import { guardInferenceRoute } from "@/lib/guard";
import { telemetry } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 8 * 1024;

/** Final browser latency samples that had no next interpretation turn to ride on. */
export async function POST(request: Request) {
  const guarded = await guardInferenceRoute(request, { requireSession: true, maxBodyBytes: MAX_BODY_BYTES, limits: [] });
  if (!guarded.ok) return guarded.response;
  const parsed = clientTelemetryBatchSchema.safeParse(guarded.body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid telemetry batch." }, { status: 400 });
  for (const sample of parsed.data.samples) telemetry.recordClientLatency(sample);
  return new NextResponse(null, { status: 204 });
}
