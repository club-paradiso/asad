/**
 * GET /api/health/openrouter — does the configured gateway actually work?
 *
 * The question this answers is the one that cannot be answered by reading
 * configuration: a key can be present and revoked, a model slug can be
 * plausible and retired, an upstream can support a model but not the
 * parameters this application depends on. All three look identical to a
 * correctly configured deployment right up until a service starts.
 *
 * So this makes ONE real, tiny, structured request and reports what came back.
 *
 * Deliberately NOT called on page load. It costs money, and a health check
 * that runs on every visit is a bill rather than a signal. It is for the
 * diagnostics page, for `npm run health:openrouter`, and for a deployment
 * smoke test.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { appEnv } from "@/lib/env";
import { clientAddress, hasAccess, isSameOrigin, limiterFor } from "@/lib/guard";
import { capabilitiesForModel, liveSuitabilityProblem } from "@/providers/llm/models";
import { OpenRouterLlmProvider, describePolicy } from "@/providers/llm/openrouter";
import { toLlmError } from "@/providers/llm/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The check must not itself become a slow page. */
const HEALTH_DEADLINE_MS = 12_000;

/**
 * The smallest structured request that still proves the thing we care about.
 *
 * Not "did it return 200" — that would pass with a model that ignores
 * `response_format` and answers in prose, which is exactly the failure the
 * live path cannot absorb. It has to come back as valid JSON matching a
 * schema.
 */
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
  /** What the capability registry believes about the configured model. */
  capabilities: {
    family: string;
    structuredOutput: string;
    sampling: string;
    liveSuitable: boolean;
    /** Populated when the model is a poor fit for the live path. */
    liveWarning?: string;
    /** Whether these came from the table or from pattern inference. */
    source: string;
  };
  policy: { summary: string; sort: string; dataCollection: string; zdr: boolean };
  /** Null when no request was attempted. */
  probe: {
    ok: boolean;
    latencyMs?: number;
    /** The model OpenRouter actually served, which may differ from the ask. */
    servedModel?: string;
    /** The upstream that served it. Never a key. */
    upstream?: string;
    /** True when the answer parsed and validated against the probe schema. */
    schemaValid?: boolean;
    error?: string;
    failureKind?: string;
  } | null;
  checkedAt: string;
}

export async function GET(request: Request) {
  // Same protections as the paid routes: this one makes a real billed call.
  if (!hasAccess(request)) {
    return NextResponse.json({ error: "This deployment is private." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not accepted." }, { status: 403 });
  }
  const verdict = limiterFor("health").check(`health:${clientAddress(request)}`);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "Health checks are rate limited; they cost money." },
      { status: 429, headers: { "retry-after": String(verdict.retryAfterSeconds) } },
    );
  }

  const env = appEnv();
  const config = env.llm.providers.openrouter;
  const { policy, primaryModel } = env.llm.openrouter;
  const caps = capabilitiesForModel(primaryModel);
  const liveWarning = liveSuitabilityProblem(caps);

  const base: OpenRouterHealth = {
    configured: config.configured,
    model: primaryModel,
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
    probe: null,
    checkedAt: new Date().toISOString(),
  };

  if (!config.apiKey) {
    return NextResponse.json(base, { headers: { "cache-control": "no-store" } });
  }

  const provider = new OpenRouterLlmProvider({
    apiKey: config.apiKey,
    model: primaryModel,
    policy,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_DEADLINE_MS);

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
        probe: {
          ok: parsed !== null,
          latencyMs: response.latencyMs,
          servedModel: response.model,
          upstream: provider.lastTurn?.upstream,
          schemaValid: parsed !== null,
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
        probe: {
          ok: false,
          // The message names the policy when routing excluded every upstream,
          // which is the failure a deployer is least likely to guess at.
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
