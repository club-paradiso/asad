"use client";

/**
 * Deployer diagnostics.
 *
 * Deliberately NOT part of the live console. §36 is right that turning the
 * interpreter's screen into a DevOps dashboard would be a mistake — during a
 * service they need three words of status, not forty metrics. Everything
 * detailed lives here instead.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Label, StatusDot } from "@/components/ui/primitives";
import { useCapability } from "@/hooks/useCapability";
import { cn } from "@/lib/cn";

interface OpenRouterConfigRow {
  primaryModel: string;
  qualityModel: string | null;
  qualityEscalation: boolean;
  policy: {
    sort: string;
    dataCollection: string;
    zdr: boolean;
    allowFallbacks: boolean;
    requireParameters: boolean;
    only: string[] | null;
    ignore: string[] | null;
    summary: string;
  };
  modelCapabilities: {
    family: string;
    structuredOutput: string;
    sampling: string;
    reasoning: string;
    maxOutputTokens: number;
    latencyClass: string;
    liveSuitable: boolean;
    liveWarning: string | null;
    promptCaching: boolean;
    source: string;
  };
}

/** Result of the on-demand health probe. Never carries a key. */
interface HealthResult {
  configured: boolean;
  model: string;
  probe: {
    ok: boolean;
    latencyMs?: number;
    servedModel?: string;
    upstream?: string;
    schemaValid?: boolean;
    error?: string;
    failureKind?: string;
  } | null;
}

interface ProviderRow {
  id: string;
  label: string;
  model: string;
  configured: boolean;
  eligible: boolean;
  ineligibleReason?: string;
  breakerState: string;
  consecutiveFailures: number;
  lastFailureKind?: string;
  quota: {
    free?: { requestsPerMinute?: number; tokensPerMinute?: number; requestsPerDay?: number };
    viableForLiveSermon?: boolean;
    detail?: string;
    requestsThisMinute: number;
    tokensThisMinute: number;
    requestsToday: number;
    pressure: number;
    pressureDetail: string;
  };
  capabilities: {
    structuredOutput: boolean;
    promptCaching: boolean;
    thinkingControl: boolean;
    recommendedLiveContextTokens?: number;
  };
  privacy: { freeTier: string; paidTier: string; note: string };
  verifiedAt: string;
}

interface Payload {
  generatedAt: string;
  stt: { provider: string; keyConfigured: boolean; ephemeralKeysAvailable: boolean; model: string };
  llm: {
    routingMode: string;
    privacyMode: string;
    allowPaidFallback: boolean;
    active: string | null;
    chain: string[];
    warnings: string[];
    providers: ProviderRow[];
    openrouter: OpenRouterConfigRow;
  };
  counter: {
    sessions: { active: number; waiting: number; totalMessages: number };
    preferOpenWeightModels: boolean;
    openWeightProviders: string[];
    openWeightAvailable: boolean;
    translationProvider: string | null;
    languages: number;
    quickPhrases: number;
    coverage: Array<{
      code: string;
      label: string;
      quickPhrases: number;
      interfaceTranslated: boolean;
      speechInput: boolean;
    }>;
    storeLimitation: string;
  };
  bible: { provider: string; translation: string; textAvailable: boolean };
  workload: Record<string, number | string>;
  telemetry: {
    latency: Record<string, { count: number; p50: number; p90: number; p95: number; max: number }>;
    slo: Array<{ stage: string; target: { p50: number; p95: number }; actual: { count: number; p50: number; p95: number }; p50Met: boolean; p95Met: boolean }>;
    tokens: { calls: number; perCall: { p50: number; p95: number; max: number }; sessionTotal: number } | null;
    schemaSuccessRate: number | null;
    failures: Record<string, number>;
  };
  configProblems: Array<{ level: string; field: string; message: string }>;
}

interface Capability {
  name: string;
  available: boolean;
  detail?: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-[var(--line)] pt-5">
      <Label>{title}</Label>
      {children}
    </section>
  );
}

const Row = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "warn" | "ok" | "bad" }) => (
  <div className="flex flex-wrap items-baseline justify-between gap-3 py-1 text-sm">
    <span className="text-[var(--fg-muted)]">{k}</span>
    <span
      className={cn(
        "text-right font-medium",
        tone === "warn" && "text-[var(--warn)]",
        tone === "ok" && "text-[var(--ok)]",
        tone === "bad" && "text-[var(--danger)]",
      )}
    >
      {v}
    </span>
  </div>
);

export function DiagnosticsScreen() {
  const [data, setData] = useState<Payload | null>(null);
  const [health, setHealth] = useState<HealthResult | "running" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Browser capabilities are static facts, not state. Reading them through the
  // render path avoids a second render pass on every load.
  const secureContext = useCapability(() => window.isSecureContext, true);
  const browser: Capability[] = [
    {
      name: "Microphone capture",
      available: useCapability(() => !!navigator.mediaDevices?.getUserMedia),
      detail: secureContext ? "secure context" : "INSECURE CONTEXT — mic will be blocked",
    },
    {
      name: "Web Speech (ko-KR)",
      available: useCapability(() => {
        const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
        return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
      }),
      detail: "zero-cost STT path",
    },
    { name: "Screen wake lock", available: useCapability(() => "wakeLock" in navigator) },
    { name: "Service worker", available: useCapability(() => "serviceWorker" in navigator) },
    {
      name: "AudioWorklet",
      available: useCapability(() => typeof AudioWorklet !== "undefined"),
    },
  ];

  const runHealth = useCallback(() => {
    setHealth("running");
    fetch("/api/health/openrouter", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((result: HealthResult | null) =>
        setHealth(
          result ?? {
            configured: true,
            model: "",
            probe: { ok: false, error: "The health endpoint refused the request." },
          },
        ),
      )
      .catch(() =>
        setHealth({
          configured: true,
          model: "",
          probe: { ok: false, error: "The health endpoint could not be reached." },
        }),
      );
  }, []);

  const load = useCallback(() => {
    fetch("/api/diagnostics")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-8">
        <p className="text-sm text-[var(--danger)]">Could not load diagnostics: {error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-8">
        <p className="text-sm text-[var(--fg-dim)]">Loading…</p>
      </div>
    );
  }

  const errors = data.configProblems.filter((p) => p.level === "error");
  const warnings = data.configProblems.filter((p) => p.level !== "error");

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col gap-5 px-5 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Diagnostics</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Deployment configuration and live health. No secrets are shown here or sent to the
            browser.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={load}>
            Refresh
          </Button>
          <Link
            href="/"
            className="self-center text-sm text-[var(--fg-muted)] underline-offset-4 hover:underline"
          >
            ← Console
          </Link>
        </div>
      </header>

      {errors.length > 0 && (
        <div className="rounded-md border border-[color-mix(in_srgb,var(--danger)_50%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-4 py-3">
          <Label className="text-[var(--danger)]">Configuration errors</Label>
          <ul className="mt-1.5 space-y-1 text-sm text-[var(--danger)]">
            {errors.map((p) => (
              <li key={p.field + p.message}>
                <code className="text-xs">{p.field}</code> — {p.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Interpretation routing">
        <Row k="Mode" v={<code>{data.llm.routingMode}</code>} />
        <Row k="Privacy mode" v={<code>{data.llm.privacyMode}</code>} />
        <Row
          k="Paid fallback"
          v={data.llm.allowPaidFallback ? "allowed" : "blocked"}
          tone={data.llm.allowPaidFallback ? "warn" : "ok"}
        />
        <Row
          k="Active provider"
          v={data.llm.active ?? "local (no cloud provider)"}
          tone={data.llm.active && data.llm.active !== "local" ? "ok" : "warn"}
        />
        <Row k="Fallback chain" v={<code className="text-xs">{data.llm.chain.join(" → ")}</code>} />
      </Section>

      {data.llm.warnings.length > 0 && (
        <Section title="Routing warnings">
          <ul className="space-y-1.5 text-sm leading-relaxed text-[var(--warn)]">
            {data.llm.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* The gateway's configuration and a way to prove it works.
          The probe is behind a button and rate limited: it makes a real billed
          request, and a health check that runs on every page load is a bill
          rather than a signal. */}
      <Section title="OpenRouter gateway">
        <Row k="Primary model" v={<code className="text-xs">{data.llm.openrouter.primaryModel}</code>} />
        <Row
          k="Quality escalation"
          v={
            data.llm.openrouter.qualityEscalation
              ? <code className="text-xs">{data.llm.openrouter.qualityModel}</code>
              : "off"
          }
        />
        <Row k="Provider routing" v={<code className="text-xs">sort={data.llm.openrouter.policy.sort}</code>} />
        <Row
          k="Data collection"
          v={data.llm.openrouter.policy.dataCollection}
          tone={data.llm.openrouter.policy.dataCollection === "deny" ? "ok" : "warn"}
        />
        <Row
          k="Zero data retention"
          v={data.llm.openrouter.policy.zdr ? "required" : "not required"}
          tone={data.llm.openrouter.policy.zdr ? "ok" : undefined}
        />
        <Row
          k="Require parameter support"
          v={data.llm.openrouter.policy.requireParameters ? "yes" : "no"}
          tone={data.llm.openrouter.policy.requireParameters ? "ok" : "warn"}
        />
        <Row
          k="Upstream fallbacks"
          v={data.llm.openrouter.policy.allowFallbacks ? "allowed (same model)" : "off"}
        />
        <Row
          k="Model capability"
          v={
            <span className="text-xs">
              {data.llm.openrouter.modelCapabilities.family} · {data.llm.openrouter.modelCapabilities.structuredOutput} ·
              sampling {data.llm.openrouter.modelCapabilities.sampling} ·{" "}
              {data.llm.openrouter.modelCapabilities.source}
            </span>
          }
        />
        {data.llm.openrouter.modelCapabilities.liveWarning && (
          <p className="text-sm leading-relaxed text-[var(--warn)]">
            {data.llm.openrouter.modelCapabilities.liveWarning}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={runHealth} disabled={health === "running"}>
            {health === "running" ? "Checking…" : "Run health check"}
          </Button>
          <span className="text-xs text-[var(--fg-dim)]">
            Makes one real, billed request. Rate limited.
          </span>
        </div>

        {typeof health === "object" && health !== null && (
          <div
            className={cn(
              "rounded-md border px-3 py-2.5 text-sm leading-relaxed",
              health.probe?.ok
                ? "border-[color-mix(in_srgb,var(--ok)_40%,transparent)] text-[var(--ok)]"
                : "border-[color-mix(in_srgb,var(--danger)_45%,transparent)] text-[var(--danger)]",
            )}
          >
            {!health.configured ? (
              <>No OPENROUTER_API_KEY is set, so nothing was checked.</>
            ) : health.probe?.ok ? (
              <>
                Healthy — structured output validated in {health.probe.latencyMs}ms
                {health.probe.upstream ? ` via ${health.probe.upstream}` : ""}
                {health.probe.servedModel && health.probe.servedModel !== health.model
                  ? ` (served ${health.probe.servedModel})`
                  : ""}
                .
              </>
            ) : (
              <>
                {health.probe?.failureKind ? `${health.probe.failureKind}: ` : ""}
                {health.probe?.error ?? "The check did not complete."}
              </>
            )}
          </div>
        )}
      </Section>

      <Section title="Providers">
        <div className="flex flex-col gap-3">
          {data.llm.providers.map((p) => (
            <div
              key={p.id}
              className="rounded-md border border-[var(--line)] bg-[var(--bg-raised)] px-3.5 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusDot
                  state={
                    !p.configured
                      ? "idle"
                      : p.eligible
                        ? "live"
                        : p.breakerState === "open"
                          ? "error"
                          : "degraded"
                  }
                />
                <span className="text-sm font-medium">{p.label}</span>
                <code className="text-xs text-[var(--fg-dim)]">{p.model}</code>
                <span className="ml-auto text-xs text-[var(--fg-dim)]">
                  {p.configured ? p.breakerState : "no key"}
                </span>
              </div>

              {p.ineligibleReason && (
                <p className="mt-1.5 text-xs text-[var(--warn)]">{p.ineligibleReason}</p>
              )}

              {p.configured && (
                <div className="mt-2 grid gap-x-6 gap-y-0.5 text-xs text-[var(--fg-dim)] sm:grid-cols-2">
                  <span>
                    this minute: {p.quota.requestsThisMinute} req ·{" "}
                    {p.quota.tokensThisMinute.toLocaleString()} tok
                  </span>
                  <span>today: {p.quota.requestsToday} req</span>
                  <span>quota pressure: {Math.round(p.quota.pressure * 100)}%</span>
                  {p.capabilities.recommendedLiveContextTokens && (
                    <span>live budget: ~{p.capabilities.recommendedLiveContextTokens} tok/call</span>
                  )}
                </div>
              )}

              {p.quota.detail && (
                <p
                  className={cn(
                    "mt-1.5 text-xs",
                    p.quota.viableForLiveSermon === false
                      ? "text-[var(--warn)]"
                      : "text-[var(--fg-dim)]",
                  )}
                >
                  Free tier: {p.quota.detail}
                </p>
              )}

              <p className="mt-1.5 text-xs leading-relaxed text-[var(--fg-dim)]">
                {p.privacy.note}{" "}
                <span className="opacity-60">(verified {p.verifiedAt})</span>
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Measured latency">
        {data.telemetry.slo.map((s) => (
          <div key={s.stage} className="py-1">
            <Row
              k={s.stage.replace(/_/g, " ")}
              v={
                s.actual.count === 0
                  ? "no samples yet"
                  : `p50 ${s.actual.p50}ms · p95 ${s.actual.p95}ms (n=${s.actual.count})`
              }
              tone={s.actual.count === 0 ? undefined : s.p95Met ? "ok" : "warn"}
            />
            <p className="text-xs text-[var(--fg-dim)]">
              target p50 ≤{s.target.p50}ms, p95 ≤{s.target.p95}ms —{" "}
              {s.actual.count === 0
                ? "not measured"
                : `${s.p50Met ? "p50 met" : "p50 MISSED"}, ${s.p95Met ? "p95 met" : "p95 MISSED"}`}
            </p>
          </div>
        ))}
        <Row
          k="Schema success rate"
          v={
            data.telemetry.schemaSuccessRate === null
              ? "no samples yet"
              : `${Math.round(data.telemetry.schemaSuccessRate * 100)}%`
          }
        />
        {data.telemetry.tokens && (
          <Row
            k="Tokens per call"
            v={`p50 ${data.telemetry.tokens.perCall.p50} · p95 ${data.telemetry.tokens.perCall.p95}`}
          />
        )}
        {Object.keys(data.telemetry.failures).length > 0 && (
          <Row
            k="Failures"
            v={Object.entries(data.telemetry.failures)
              .map(([k, v]) => `${k}×${v}`)
              .join(", ")}
            tone="warn"
          />
        )}
      </Section>

      <Section title="Speech to text">
        <Row k="Provider" v={<code>{data.stt.provider}</code>} />
        <Row
          k="Key configured"
          v={data.stt.keyConfigured ? "yes" : "no"}
          tone={data.stt.keyConfigured ? "ok" : "warn"}
        />
        {data.stt.provider === "deepgram" && (
          <Row
            k="Short-lived browser keys"
            v={data.stt.ephemeralKeysAvailable ? "yes" : "NO — account key reaches the browser"}
            tone={data.stt.ephemeralKeysAvailable ? "ok" : "bad"}
          />
        )}
      </Section>

      <Section title="Counter Mode">
        <Row
          k="Open-weight models preferred"
          v={data.counter.preferOpenWeightModels ? "yes" : "no"}
        />
        <Row
          k="Open-weight provider configured"
          v={
            data.counter.openWeightAvailable
              ? data.counter.openWeightProviders.join(", ")
              : "none — the counter will use whatever is configured"
          }
          tone={data.counter.openWeightAvailable ? "ok" : "warn"}
        />
        <Row
          k="Provider a counter turn would reach"
          v={<code>{data.counter.translationProvider ?? "none configured"}</code>}
          tone={data.counter.translationProvider ? "ok" : "bad"}
        />
        <Row
          k="Sessions"
          v={`${data.counter.sessions.active} active · ${data.counter.sessions.waiting} waiting`}
        />
        <Row
          k="Session storage"
          v={data.counter.storeLimitation}
          tone="warn"
        />
        <Row
          k="Languages"
          v={`${data.counter.languages} offered · ${data.counter.quickPhrases} quick phrases`}
        />

        {/* Coverage is where a visitor's experience actually differs, so it is
            listed rather than averaged into a single misleading percentage. */}
        <details className="mt-1">
          <summary className="cursor-pointer text-sm text-[var(--fg-muted)]">
            Per-language coverage
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[26rem] text-left text-xs">
              <thead className="text-[var(--fg-dim)]">
                <tr>
                  <th className="py-1 pr-3 font-normal">Language</th>
                  <th className="py-1 pr-3 font-normal">Quick phrases</th>
                  <th className="py-1 pr-3 font-normal">Interface</th>
                  <th className="py-1 font-normal">Speech input</th>
                </tr>
              </thead>
              <tbody className="text-[var(--fg-muted)]">
                {data.counter.coverage.map((row) => (
                  <tr key={row.code} className="border-t border-[var(--line)]">
                    <td className="py-1 pr-3 text-[var(--fg)]">{row.label}</td>
                    <td className="py-1 pr-3">{row.quickPhrases}%</td>
                    <td className="py-1 pr-3">
                      {row.interfaceTranslated ? "translated" : "English"}
                    </td>
                    <td className="py-1">{row.speechInput ? "yes" : "type only"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Section>

      <Section title="Browser capability">
        {browser.map((c) => (
          <Row
            key={c.name}
            k={c.name}
            v={`${c.available ? "available" : "unavailable"}${c.detail ? ` · ${c.detail}` : ""}`}
            tone={c.available ? "ok" : "warn"}
          />
        ))}
      </Section>

      {warnings.length > 0 && (
        <Section title="Configuration notices">
          <ul className="space-y-1.5 text-sm text-[var(--fg-muted)]">
            {warnings.map((p) => (
              <li key={p.field + p.message}>
                <code className="text-xs text-[var(--fg-dim)]">{p.field}</code> — {p.message}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="mt-2 text-xs text-[var(--fg-dim)]">
        Generated {new Date(data.generatedAt).toLocaleString()}. Measured workload:{" "}
        {String(data.workload.callsPerMinute)} calls/min at {String(data.workload.tokensPerCallFull)}{" "}
        tokens per call.
      </p>
    </div>
  );
}
