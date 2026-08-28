/**
 * What OpenRouter is serving free, right now.
 *
 * The problem this solves: a deployment that wants to run on open weights has
 * to name a model slug, and the set of free open-weight models OpenRouter
 * serves ROTATES. Slugs appear, get retired, and change suffix. Any list
 * hard-coded here is wrong within months, and the failure mode is the worst
 * kind — a plausible-looking slug that 404s the first time a service starts.
 *
 * So this asks OpenRouter instead of guessing, and filters the answer down to
 * models that can actually do this job:
 *
 *   1. **Free.** Both prompt and completion priced at zero.
 *   2. **Open weights.** The stated requirement, judged from the slug by the
 *      same rule the router uses, so the two can never disagree.
 *   3. **Structurally capable.** A model that cannot be asked for JSON is
 *      useless here regardless of how good its prose is — every turn in this
 *      application is a schema-validated object, not a chat reply.
 *   4. **Live-suitable.** No always-on reasoning: an unbounded thinking phase
 *      in front of every turn is exactly what simultaneous interpretation
 *      cannot absorb.
 *
 * Nothing here is a trust boundary. The catalogue is advisory — it suggests
 * slugs for a human to pin. Every actual response still goes through Zod.
 */
import { z } from "zod";
import { isOpenWeightModel } from "./capabilities";
import { capabilitiesForModel, liveSuitabilityProblem } from "./models";

/** Where the public catalogue lives. Overrideable for tests and mirrors. */
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** A catalogue lookup must never become a slow page. */
export const CATALOGUE_DEADLINE_MS = 8000;

/**
 * Deliberately permissive.
 *
 * This is a third-party payload that will grow fields we do not know about,
 * and a strict schema would turn every upstream addition into an outage. Only
 * `id` is genuinely required; everything else degrades to "unknown", which the
 * filters treat as "do not recommend".
 */
const modelEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  context_length: z.number().optional(),
  pricing: z
    .object({
      prompt: z.union([z.string(), z.number()]).optional(),
      completion: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
  supported_parameters: z.array(z.string()).optional(),
});

const cataloguePayloadSchema = z.object({
  data: z.array(z.unknown()),
});

export interface OpenWeightSuggestion {
  /** The slug to pin, verbatim. */
  id: string;
  /** Human-facing name, for the diagnostics list. */
  name: string;
  contextTokens?: number;
  /** Whether the model advertises native JSON-schema structured output. */
  structuredOutput: boolean;
  family: string;
}

export type CatalogueResult =
  | { ok: true; source: "openrouter"; models: OpenWeightSuggestion[] }
  /**
   * The catalogue could not be read. The caller still gets something usable —
   * see `VERIFIED_FALLBACK` — plus the reason, because "we could not check"
   * and "there is nothing" are different answers and must not look alike.
   */
  | { ok: false; source: "fallback"; models: OpenWeightSuggestion[]; reason: string };

/**
 * Slugs verified ON OPENROUTER, as a floor when the catalogue is unreachable.
 *
 * The provider qualifier is the whole point, and getting it wrong is how this
 * list first shipped. `docs/counter-mode.md` lists three open-weight options,
 * but two of them — `openai/gpt-oss-120b` and `qwen/qwen3-32b` — are verified
 * via **Groq**, not OpenRouter. Carrying them here made this endpoint hand back
 * `OPENROUTER_PRIMARY_MODEL=openai/gpt-oss-120b`: a slug from another
 * provider's namespace, offered as fact. That is precisely the
 * plausible-looking-id failure this module exists to prevent, so the floor is
 * now only what the repository has verified against OpenRouter itself.
 *
 * One entry is the honest length of that list. A short floor plus a stated
 * reason beats a longer one that might be wrong — the live catalogue is the
 * real answer, and this only exists for when it cannot be read.
 */
export const VERIFIED_FALLBACK: OpenWeightSuggestion[] = [
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B Instruct (free)",
    contextTokens: 131_072,
    structuredOutput: true,
    family: "Open weights",
  },
];

/** Zero is zero however the upstream spells it — "0", "0.0", 0. */
function isFree(value: string | number | undefined): boolean {
  if (value === undefined) return false;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) && n === 0;
}

/**
 * Whether the upstream says this model can be asked for structured output.
 *
 * Absent `supported_parameters` is treated as "no". Under-claiming costs a
 * model a place on a suggestion list; over-claiming costs the interpreter a
 * turn mid-sermon.
 */
function advertisesStructuredOutput(params: string[] | undefined): boolean {
  if (!params) return false;
  return params.includes("structured_outputs") || params.includes("response_format");
}

/**
 * Rank the survivors.
 *
 * Bigger context first, because the live path's binding constraint is the
 * system prompt plus rolling context, then slug order for a stable list — a
 * suggestion list that reshuffles between reloads is not a list a deployer can
 * talk about.
 */
function rank(a: OpenWeightSuggestion, b: OpenWeightSuggestion): number {
  const byContext = (b.contextTokens ?? 0) - (a.contextTokens ?? 0);
  return byContext !== 0 ? byContext : a.id.localeCompare(b.id);
}

/** Turn one raw catalogue entry into a suggestion, or null if unfit. */
export function toSuggestion(raw: unknown): OpenWeightSuggestion | null {
  const parsed = modelEntrySchema.safeParse(raw);
  if (!parsed.success) return null;
  const entry = parsed.data;

  if (!isFree(entry.pricing?.prompt) || !isFree(entry.pricing?.completion)) return null;
  if (!isOpenWeightModel(entry.id)) return null;
  if (!advertisesStructuredOutput(entry.supported_parameters)) return null;

  // The same suitability rule the live path applies, so a model this list
  // recommends cannot be one the launcher would then refuse to drive.
  const caps = capabilitiesForModel(entry.id);
  if (liveSuitabilityProblem(caps) !== null) return null;

  return {
    id: entry.id,
    name: entry.name ?? entry.id,
    contextTokens: entry.context_length ?? caps.contextTokens,
    structuredOutput: caps.structuredOutput === "json_schema",
    family: caps.family,
  };
}

/**
 * Ask OpenRouter which free open-weight models it is serving.
 *
 * No key required — the catalogue is public. `fetchImpl` is a seam for tests.
 */
export async function freeOpenWeightModels(options: {
  limit?: number;
  fetchImpl?: typeof fetch;
  url?: string;
} = {}): Promise<CatalogueResult> {
  const limit = options.limit ?? 8;
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOGUE_DEADLINE_MS);

  try {
    const response = await doFetch(options.url ?? OPENROUTER_MODELS_URL, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return fallback(`OpenRouter answered ${response.status} for its model catalogue.`);
    }

    const payload = cataloguePayloadSchema.safeParse(await response.json());
    if (!payload.success) {
      return fallback("OpenRouter's model catalogue was not in the expected shape.");
    }

    const models = payload.data.data
      .map(toSuggestion)
      .filter((entry): entry is OpenWeightSuggestion => entry !== null)
      .sort(rank)
      .slice(0, limit);

    // Reachable but nothing qualified is a real answer, not a failure — say so
    // with the floor rather than an empty list a deployer cannot act on.
    if (models.length === 0) {
      return fallback("OpenRouter is currently serving no free open-weight model this app can drive.");
    }

    return { ok: true, source: "openrouter", models };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? `OpenRouter's model catalogue did not answer within ${CATALOGUE_DEADLINE_MS} ms.`
        : `OpenRouter's model catalogue could not be reached: ${
            error instanceof Error ? error.message : "unknown error"
          }`;
    return fallback(reason);
  } finally {
    clearTimeout(timer);
  }
}

function fallback(reason: string): CatalogueResult {
  return { ok: false, source: "fallback", models: VERIFIED_FALLBACK, reason };
}
