import { describe, expect, it, vi } from "vitest";
import { azureMonthlyBudgetLimit, budgetPeriod, reserveAzureCharactersWithConfig } from "./azure-budget";

const config = {url:"https://redis.invalid",token:"TEST_REDIS_TOKEN",source:"upstash" } as const;
describe("cross-instance Azure monthly F0 guard", () => {
  it("caps user budgets below the 2M tier and matches UTC billing month", () => {
    expect(azureMonthlyBudgetLimit({ ASAD_AZURE_F0_MONTHLY_CAP: "2000000" }))
      .toBe(1_500_000);
    expect(azureMonthlyBudgetLimit({ ASAD_AZURE_F0_MONTHLY_CAP: "200000" }))
      .toBe(200000);
    expect(budgetPeriod(new Date("2026-10-31T23:59:59Z")).key).toContain("2026-10");
    expect(budgetPeriod(new Date("2026-11-01T00:00:00Z")).key).toContain("2026-11");
  });
  it("requires atomic reservation and never passes over-cap requests", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({result:1}), {status:200})) as unknown as typeof fetch;
    expect(await reserveAzureCharactersWithConfig(config, 100, 1000, new Date(), ok)).toBe(true);
    const [url, init] = vi.mocked(ok).mock.calls[0];
    expect(String(url)).toBe(config.url);
    const args = JSON.parse(String(init?.body));
    expect(args[0]).toBe("EVAL");
    expect(args[4]).toBe(100);
    expect(args[5]).toBe(1000);
    const full = vi.fn(async () => new Response(JSON.stringify({result:0}))) as unknown as typeof fetch;
    expect(await reserveAzureCharactersWithConfig(config, 100, 1000, new Date(), full)).toBe(false);
  });
  it("fails closed on Redis errors or unreasonable input", async () => {
    const broken = vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch;
    expect(await reserveAzureCharactersWithConfig(config, 100, 1000, new Date(), broken)).toBe(false);
    expect(await reserveAzureCharactersWithConfig(config, 3000, 1000, new Date(), broken)).toBe(false);
  });
});
