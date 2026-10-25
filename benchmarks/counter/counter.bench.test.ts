/**
 * Counter Mode offline benchmark.
 *
 * Runs under vitest so it can exercise the real route handlers (which import
 * `server-only`) against an in-memory store with counted round trips, and the
 * real validators against the synthetic corpus. Writes its report to
 * `benchmarks/results/counter-latest.{json,md}` for the docs to quote.
 *
 *   npm run bench:counter
 *
 * Nothing here contacts a provider or a network. Provider latency enters the
 * latency model only as a stated parameter, and the report says so.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AFTER, BEFORE, estimateTurn, simulateRecipientDelivery, type LatencyInputs } from "./latency-model";
import { renderQualityMarkdown, runQualityBenchmark } from "./quality";

const translateForCounter = vi.hoisted(() => vi.fn());
vi.mock("@/counter/translate", () => ({ translateForCounter, COUNTER_DEADLINE_MS: 6000 }));
vi.mock("@/learning/vault", () => ({
  recordLearningCandidate: vi.fn(async () => ({ stored: false, durable: false })),
}));

import { PATCH, POST } from "@/app/api/counter/session/route";
import { POST as SEND } from "@/app/api/counter/message/route";
import { __setCounterStore, counterStore, createMemoryStore } from "@/counter/store";
import { COUNTER_TOKEN_HEADER } from "@/counter/access";
import { SESSION_COOKIE, __resetGuards, issueSessionToken } from "@/lib/guard";
import type { SessionView } from "@/counter/types";

const RESULTS_DIR = join(process.cwd(), "benchmarks", "results");

/** Deployment-shaped parameters. Stated, not measured — see the report header. */
const SCENARIOS: Array<{ name: string; inputs: LatencyInputs }> = [
  { name: "same-region Redis, fast free model", inputs: { redisRttMs: 15, providerMs: 1500, networkOneWayMs: 40, cpuMs: 6 } },
  { name: "cross-region Redis, fast free model", inputs: { redisRttMs: 120, providerMs: 1500, networkOneWayMs: 60, cpuMs: 6 } },
  { name: "same-region Redis, slow model", inputs: { redisRttMs: 15, providerMs: 3500, networkOneWayMs: 40, cpuMs: 6 } },
  { name: "cross-region Redis, slow model, mobile data", inputs: { redisRttMs: 120, providerMs: 3500, networkOneWayMs: 120, cpuMs: 6 } },
];

function countingStore() {
  const inner = counterStore();
  const calls = { get: 0, update: 0, writes: 0 };
  const store: typeof inner = Object.create(inner);
  store.get = (code) => {
    calls.get += 1;
    return inner.get(code);
  };
  store.update = (code, mutate) => {
    calls.update += 1;
    return inner.update(code, (session) => {
      const verdict = mutate(session);
      if (verdict !== false) calls.writes += 1;
      return verdict;
    });
  };
  __setCounterStore(store);
  return calls;
}

describe("Counter Mode offline benchmark", () => {
  beforeEach(() => {
    __setCounterStore(createMemoryStore());
    __resetGuards();
    translateForCounter.mockReset();
    translateForCounter.mockResolvedValue({
      ok: true,
      output: { translation: "Please wait a moment.", confidence: "high" },
      provider: "bench",
      model: "bench-model",
      latencyMs: 0,
    });
  });

  it("measures the validators over the corpus and the route's store round trips, then writes the report", async () => {
    /* --- Quality --------------------------------------------------------- */
    const quality = runQualityBenchmark();

    /* --- Store round trips on the real route ----------------------------- */
    const created = await POST(
      new Request("http://localhost/api/counter/session", {
        method: "POST",
        body: JSON.stringify({ hostLang: "ko-KR" }),
      }),
    );
    const { session, participantToken } = (await created.json()) as {
      session: SessionView;
      participantToken: string;
    };
    await PATCH(
      new Request("http://localhost/api/counter/session", {
        method: "PATCH",
        body: JSON.stringify({ code: session.code, guestLang: "en-US" }),
      }),
    );
    const calls = countingStore();
    const turns = ["잠시만 기다려 주세요.", "여권을 보여 주시겠어요?", "예약하셨나요?", "3번 창구로 가세요."];
    for (const text of turns) {
      const response = await SEND(
        new Request("http://localhost/api/counter/message", {
          method: "POST",
          headers: {
            origin: "http://localhost",
            cookie: `${SESSION_COOKIE}=${issueSessionToken()}`,
            "content-type": "application/json",
            [COUNTER_TOKEN_HEADER]: participantToken,
            "x-asad-message-id": `bench-${text.length}-${Math.random().toString(36).slice(2)}`,
          },
          body: JSON.stringify({ code: session.code, source: "text", text }),
        }),
      );
      expect(response.status).toBe(200);
    }
    // Per ordinary turn: one admission read (no write) + one persist (write).
    expect(calls.update / turns.length).toBe(2);
    expect(calls.writes / turns.length).toBe(1);
    expect(calls.get).toBe(0);
    // Redis round trips per turn = admission GET (1) + persist GET+EVAL (2)
    // + shared rate-limit EVAL (1, in the guard) = 4. Before: 7 (see model).
    const storeRoundTripsPerTurn = (calls.update - calls.writes) * 1 + calls.writes * 2;
    expect(storeRoundTripsPerTurn / turns.length + 1).toBe(AFTER.storeRoundTrips);

    /* --- Latency model ----------------------------------------------------- */
    const model = SCENARIOS.map(({ name, inputs }) => ({
      name,
      inputs,
      before: estimateTurn(BEFORE, inputs),
      after: estimateTurn(AFTER, inputs),
    }));
    const simulation = SCENARIOS.map(({ name, inputs }) => {
      const sim = {
        turns: 5000,
        seed: 20261025,
        redisRttMs: { min: inputs.redisRttMs * 0.7, max: inputs.redisRttMs * 1.6 },
        providerMs: { median: inputs.providerMs, spread: 1.6 },
        networkOneWayMs: { min: inputs.networkOneWayMs * 0.6, max: inputs.networkOneWayMs * 2 },
        cpuMs: inputs.cpuMs,
      };
      return {
        name,
        before: simulateRecipientDelivery(BEFORE, sim),
        after: simulateRecipientDelivery(AFTER, sim),
      };
    });

    /* --- Report ------------------------------------------------------------ */
    const report = {
      generatedAt: new Date().toISOString(),
      note:
        "Offline benchmark. Validator results are exact over the synthetic corpus. Latency figures are a MODEL over stated parameters (one Redis round trip, one provider response, one poll interval) and the measured round-trip structure of the route; they are not provider or network measurements.",
      quality,
      roundTripsPerTurn: { before: BEFORE.storeRoundTrips, after: AFTER.storeRoundTrips },
      pollIntervalMs: { before: BEFORE.pollIntervalMs, after: AFTER.pollIntervalMs },
      model,
      simulation,
    };

    const md: string[] = [];
    md.push(`# Counter Mode offline benchmark — ${report.generatedAt}`, "", report.note, "");
    md.push("## Translation-quality validators", "", renderQualityMarkdown(quality), "");
    md.push("## Server round trips per ordinary turn", "");
    md.push(`| | Redis round trips | Recipient poll interval |`, `| --- | --- | --- |`);
    md.push(`| Before (main 2e57a0a) | ${BEFORE.storeRoundTrips} | ${BEFORE.pollIntervalMs} ms |`);
    md.push(`| After (this branch, asserted against the route) | ${AFTER.storeRoundTrips} | ${AFTER.pollIntervalMs} ms while live |`, "");
    md.push("## Latency model (deterministic arithmetic)", "");
    md.push(
      `| Scenario | Sender visible before → after | Recipient mean before → after | Recipient worst before → after |`,
      `| --- | --- | --- | --- |`,
    );
    for (const row of model) {
      md.push(
        `| ${row.name} | ${row.before.senderVisibleMs} → ${row.after.senderVisibleMs} ms | ${row.before.recipientMeanMs} → ${row.after.recipientMeanMs} ms | ${row.before.recipientWorstMs} → ${row.after.recipientWorstMs} ms |`,
      );
    }
    md.push("", "## Recipient delivery, Monte Carlo over jittered inputs (5,000 turns, seeded)", "");
    md.push(`| Scenario | p50 before → after | p95 before → after | p99 before → after |`, `| --- | --- | --- | --- |`);
    for (const row of simulation) {
      const gain = (a: number, b: number) => `${a} → ${b} ms (${(((a - b) / a) * 100).toFixed(0)}%)`;
      md.push(
        `| ${row.name} | ${gain(row.before.p50, row.after.p50)} | ${gain(row.before.p95, row.after.p95)} | ${gain(row.before.p99, row.after.p99)} |`,
      );
    }

    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(join(RESULTS_DIR, "counter-latest.json"), JSON.stringify(report, null, 2));
    writeFileSync(join(RESULTS_DIR, "counter-latest.md"), `${md.join("\n")}\n`);

    // Regression gates: the validators must keep every faithful rendering and
    // catch every corruption in the corpus. A new false positive or negative
    // fails this benchmark rather than silently moving a number in a report.
    expect(quality.findings).toEqual([]);
  });
});
