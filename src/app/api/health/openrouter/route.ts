/**
 * GET /api/health/openrouter — does the configured gateway actually work?
 *
 * The question this answers is the one that cannot be answered by reading
 * configuration: a key can be present and revoked, a model slug can be
 * plausible and retired, an upstream can support a model but not the
 * parameters this application depends on. All three look identical to a
 * correctly configured deployment right up until a service starts.
 *
 * So this makes ONE real, tiny, structured inference request and, in parallel,
 * reads non-secret metadata for the current OpenRouter key. The account lookup
 * lets diagnostics distinguish the 50-request unfunded free tier from an
 * account that has moved off that tier without exposing spend or key identity.
 *
 * Deliberately NOT called on page load. The inference probe costs quota, and a
 * health check that runs on every visit is a bill rather than a signal.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { appEnv } from "@/lib/env";
import { clientAddress, hasAccess, isSameOrigin, limiterFor } from "@/lib/guard";
import { llmRouter } from "@/providers/llm";
import { capabilitiesForModel, liveSuitabilityProblem } from "@/providers/llm/models";
import { OpenRouterLlmProvider, describePolicy } from "@/providers/llm/openrouter";
import { publicFreeOpenRouterFallbackModels } from "@/providers/llm/public-free";
import { toLlmError } from "@/providers/llm/errors";
import {
  inspectOpenRouterAccount,
  OPENROUTER_FREE_MODEL_RPD,
  OPENROUTER_FUNDING_THRESHOLD_USD,
  type OpenRouterAccountStatus,
} from "@/providers/llm/openrouter-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The check must not itself become a slow page. */
const HEALTH_DEADLINE_MS = 12_000;

const PROBE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    language: { type: "string" },
  },
  required: ["ok", "language"],
  additionalProperties: false,
};

const probeResultSchema = z.object({ ok: z.boolean(), language: z.string() });

export interface OpenRouterHealth {
  configured: boolean;
  model: string;
  fallbackModels: readonly string[];
  capabilities: {
    family: string;
    structuredOutput: string;
    sampling: string;
    liveSuitable: boolean;
    liveWarning?: string;
    source: string;
  };
  policy: { summary: string; sort: string; dataCollection: string; zdr: boolean };
  /** Safe account metadata only. No label, spend, owner id or key material. */
  account: (OpenRouterAccountStatus & {
    documentedUnfundedRpd: number;
    documentedFundedRpd: number;
    fundingThresholdUsd: number;
  }) | null;
  probe: {
    ok: boolean;
    latencyMs?: number;
    servedModel?: string;
    upstream?: string;
    schemaValid?: boolean;
    /** Raw rate-limit remainder reported on the inference response, diagnostic only. */
    requestsRemaining?: number;
    tokensRemaining?: number;
    rateLimitResetAt?: number;
    error?: string;
    failureKind?: string;
  } | null;
  checkedAt: string;
}

export async function GET(request: Request) {
  if (!hasAccess(request)) {
    return NextResponse.json({ error: "This deployment is private." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not accepted." }, { status: 403 });
  }
  const verdict = limiterFor("health").check(`health:${clientAddress(request)}`);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "Health checks are rate limited; they cost quota." },
      { status: 429, headers: { "retry-after": String(verdict.retryAfterSeconds) } },
    );
  }

  // Resolve the same effective environment the translation routes use before
  // inspecting provider configuration. Public deployments may deliberately
  // restore an explicit non-billable OpenRouter `:free` model.
  llmRouter();
  const env = appEnv();
  const config = env.llm.providers.openrouter;
  const { policy, primaryModel } = env.llm.openrouter;
  const fallbackModels = publicFreeOpenRouterFallbackModels(env);
  const caps = capabilitiesForModel(primaryModel);
  const liveWarning = liveSuitabilityProblem(caps);

  const base: OpenRouterHealth = {
    configured: config.configured,
    model: primaryModel,
    fallbackModels,
    capabilities: {
      family: caps.family,
      structuredOutput: caps.structuredOutput,
      sampling: caps.sampling,
      liveSuitable: caps.liveSuitable,
      liveWarning: liveWarning ?? undefined,
      source: caps.source,
    },
    policy: {
      summary: describePolicy(policy),
      sort: policy.sort,
      dataCollection: policy.dataCollection,
      zdr: policy.zdr,
    },
    account: null,
    probe: null,
    checkedAt: new Date().toISOString(),
  };

  if (!config.apiKey) {
    return NextResponse.json(base, { headers: { "cache-control": "no-store" } });
  }

  const provider = new OpenRouterLlmProvider({
    apiKey: config.apiKey,
    model: primaryModel,
    fallbackModels,
    policy,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_DEADLINE_MS);
  const accountPromise = inspectOpenRouterAccount(config.apiKey, { signal: controller.signal });

  const decorateAccount = async () => ({
    ...(await accountPromise),
    documentedUnfundedRpd: OPENROUTER_FREE_MODEL_RPD.unfunded,
    documentedFundedRpd: OPENROUTER_FREE_MODEL_RPD.funded10,
    fundingThresholdUsd: OPENROUTER_FUNDING_THRESHOLD_USD,
  });

  try {
    const response = await provider.complete({
      system: 'Reply with JSON only: {"ok":true,"language":"ko"}',
      user: "Health check.",
      maxOutputTokens: 64,
      temperature: 0,
      jsonSchema: PROBE_SCHEMA,
      thinking: "none",
      signal: controller.signal,
    });

    const parsed = safeParseProbe(response.text);
    return NextResponse.json(
      {
        ...base,
        account: await decorateAccount(),
        probe: {
          ok: parsed !== null,
          latencyMs: response.latencyMs,
          servedModel: response.model,
          upstream: provider.lastTurn?.upstream,
          schemaValid: parsed !== null,
          requestsRemaining: response.rateLimit?.requestsRemaining,
          tokensRemaining: response.rateLimit?.tokensRemaining,
          rateLimitResetAt: response.rateLimit?.resetAt,
          error:
            parsed === null
              ? "The model answered, but the response did not match the requested schema."
              : undefined,
        },
      } satisfies OpenRouterHealth,
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const llmError = toLlmError(error);
    return NextResponse.json(
      {
        ...base,
        account: await decorateAccount(),
        probe: {
          ok: false,
          error: llmError.message,
          failureKind: llmError.kind,
        },
      } satisfies OpenRouterHealth,
      { headers: { "cache-control": "no-store" } },
    );
  } finally {
    clearTimeout(timer);
  }
}

function safeParseProbe(raw: string): z.infer<typeof probeResultSchema> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const result = probeResultSchema.safeParse(JSON.parse(raw.slice(start, end + 1)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
