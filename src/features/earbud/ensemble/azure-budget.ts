import "server-only";
import { resolveCounterRedisConfig, type RedisConfig } from "@/counter/store";

/**
 * Strict cross-instance monthly reservation *before* sending Azure requests.
 * If Redis is missing or fails, Azure is NOT called. This ledger protects
 * ASAD's own traffic only; it cannot observe Azure usage from other clients,
 * other deployments, or changes to subscription billing.
 */
const PREFIX = "asad:earbud:azure-f0:chars:";
export const MAX_AZURE_F0_BUDGET = 1_500_000; // safety margin below 2M F0 allowance
const LUA = `
local value = redis.call('INCRBY', KEYS[1], ARGV[1])
if value > tonumber(ARGV[2]) then
  redis.call('DECRBY', KEYS[1], ARGV[1])
  return 0
end
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`;

export function azureMonthlyBudgetLimit(source: NodeJS.ProcessEnv = process.env): number {
  const value = Number(source.ASAD_AZURE_F0_MONTHLY_CAP ?? "1500000");
  if (!Number.isSafeInteger(value) || value < 1000 || value > MAX_AZURE_F0_BUDGET)
    return MAX_AZURE_F0_BUDGET;
  return value;
}

export function budgetPeriod(now: Date): { key: string; ttlMs: number } {
  const year = now.getUTCFullYear(), month = now.getUTCMonth();
  // Retain through end of month, not rolling thirty days.
  const nextMonth = Date.UTC(year, month + 1, 1);
  const ttlMs = Math.max(1000, nextMonth - now.getTime() + 86_400_000);
  return {
    key: `${PREFIX}${year}-${String(month + 1).padStart(2, "0")}`,
    ttlMs,
  };
}

type RedisResult = { result?: number | string; error?: string };
export async function reserveAzureCharactersWithConfig(
  config: RedisConfig, chars: number, cap: number,
  now: Date = new Date(), fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!Number.isSafeInteger(chars) || chars < 1 || chars > 2000 ||
      !Number.isSafeInteger(cap) || cap < chars || cap > MAX_AZURE_F0_BUDGET) return false;
  const { key, ttlMs } = budgetPeriod(now);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetcher(config.url, {
      method: "POST", cache: "no-store", signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(["EVAL", LUA, 1, key, chars, cap, ttlMs]),
    });
    if (!response.ok) return false;
    const result = await response.json() as RedisResult;
    return !result.error && Number(result.result) === 1;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function reserveAzureCharacters(chars: number): Promise<boolean> {
  const config = resolveCounterRedisConfig();
  if (!config) return false;
  return reserveAzureCharactersWithConfig(config, chars, azureMonthlyBudgetLimit());
}
