/**
 * GET /api/learning/status — non-secret status for the Learning Vault.
 *
 * This endpoint intentionally exposes no Redis URL, token, key name, sample,
 * candidate content, or count. It exists only so a deployer can verify that
 * durable storage is connected after provisioning Upstash/Vercel KV.
 */
import { NextResponse } from "next/server";
import { learningVaultInfo } from "@/learning/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    learningVault: learningVaultInfo(),
  });
}
