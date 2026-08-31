/**
 * GET /api/config — what this deployment can actually do.
 *
 * The console asks once at startup so it can present honest options: if no
 * cloud recogniser is configured, do not offer one; if no LLM is configured,
 * say that English assistance will be rule-based rather than letting the
 * interpreter discover it live.
 *
 * Only capability flags are exposed. No keys, no ids, no endpoints.
 */
import { NextResponse } from "next/server";
import { appEnv } from "@/lib/env";
import {
  LIVE_WORKLOAD,
  assessFreeTierViability,
  capabilitiesFor,
  trainsOnSubmissions,
} from "@/providers/llm/capabilities";
import { llmRouter } from "@/providers/llm";
import { OPEN_WEIGHT } from "@/providers/llm/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AppConfig {
  stt: { configured: string; cloudAvailable: boolean };
  llm: {
    /** The provider a live turn would actually reach right now. */
    configured: string;
    modelAvailable: boolean;
    routingMode: string;
    /**
     * Whether that provider's quota can carry a full 45-minute sermon.
     *
     * A separate question from `modelAvailable`, and the one that actually
     * bites: Groq's and OpenRouter's free tiers connect perfectly and then run
     * out within minutes, which looks identical to "not configured" unless the
     * launcher says otherwise.
     */
    sustainsLiveSermon: boolean;
    capacityNote?: string;
    /**
     * Providers in the active chain whose free tier may use submitted content
     * to improve their products. Labels and notes only — never keys.
     */
    freeTierDisclosure: Array<{ label: string; note: string }>;
  };
  bible: { configured: string; textAvailable: boolean; translation: string };
  /**
   * What the visitor is told before they say anything.
   *
   * A stranger at a counter is asked to type medical, legal or immigration
   * details into a phone they did not choose. They are owed the name of the
   * company that will see it, and whether that company may keep it — on the
   * join screen, not buried in a policy page they cannot read.
   */
  counter: {
    /** Provider label, or null when nothing can translate. */
    provider: string | null;
    /** True when the active free tier may use submissions for training. */
    mayTrain: boolean;
    /** The provider's own data-use note, in English. */
    note: string;
    openWeightModel: boolean;
  };
}

export async function GET() {
  // Read the PARSED environment, not raw process.env. The two disagree in the
  // case that matters: a deployment configured the Phase 2 way — GROQ_API_KEY,
  // OPENROUTER_API_KEY, GEMINI_API_KEY — sets none of the Phase 1 variables
  // this route used to check, so a correctly connected deployment reported
  // itself as having no model at all while the router was happily using one.
  const env = appEnv();
  const router = llmRouter();
  const plan = router.plan();

  const stt = env.stt.provider;
  const bible = env.bible.provider;

  const cloudAvailable =
    (stt === "deepgram" && !!env.stt.deepgramKey) ||
    (stt === "openai" && !!env.stt.openaiKey);

  // Live is continuous. Prefer a configured provider whose documented free
  // quota can actually carry the workload; a one-shot-capable provider that
  // dies four minutes into a sermon is not the provider this screen should
  // advertise as active. If none can sustain it, fall back to the normal plan
  // and expose the capacity warning as before.
  const liveActive = router.preferred((id) => {
    if (env.llm.paidTier.has(id)) return true;
    const caps = capabilitiesFor(id);
    return !caps.freeTierPossible ||
      assessFreeTierViability(id, LIVE_WORKLOAD.tokensPerCallFull).viable;
  });

  // The router is the authority on what a live turn would reach: it accounts
  // for every provider, the routing mode, the privacy mode, breaker state and
  // quota pressure.
  const active = liveActive ?? plan.active;
  const modelAvailable = active !== null && active !== "local";

  // Connected is not the same as sufficient. Say which.
  const activePaid = active !== null && env.llm.paidTier.has(active);
  const viability =
    modelAvailable && capabilitiesFor(active).freeTierPossible && !activePaid
      ? assessFreeTierViability(active, LIVE_WORKLOAD.tokensPerCallFull)
      : undefined;

  const textAvailable = env.bible.provider !== "reference-only";
  // OpenRouter with `data_collection: deny` is not a provider that may train on
  // this sermon, and disclosing it as one would be crying wolf — the whole
  // value of this notice is that it only appears when it is true.
  const denies = env.llm.openrouter.policy.dataCollection === "deny";
  const freeTierDisclosure = plan.chain
    .filter(
      (id) =>
        id !== "local" &&
        trainsOnSubmissions(id, env.llm.paidTier.has(id), {
          openRouterDeniesCollection: denies,
        }),
    )
    .map((id) => ({ label: capabilitiesFor(id).label, note: capabilitiesFor(id).privacyNote }));

  // The provider a counter turn would actually reach, which is not necessarily
  // the one the live console prefers.
  //
  // `wouldReach`, not `preferred`: the open-weight setting is an ordering, not
  // a requirement, so a deployment with only a proprietary key still
  // translates — and must be disclosed as translating, by name. Asking
  // `preferred(OPEN_WEIGHT)` instead asked whether the *preference* was
  // satisfiable, and answered `null` for every deployment without an
  // open-weight key, which the join screen then reported to the visitor as
  // "no translation provider is configured".
  const counterProvider = router.wouldReach(
    env.llm.counterPreferOpen ? OPEN_WEIGHT : undefined,
  );
  const counterCaps = counterProvider ? capabilitiesFor(counterProvider) : null;

  const config: AppConfig = {
    stt: { configured: stt, cloudAvailable },
    llm: {
      configured: active ? capabilitiesFor(active).label : "local interpreter",
      modelAvailable,
      routingMode: env.llm.routingMode,
      // No cloud model cannot "fail to sustain" anything; that reads as a
      // second problem when there is only one.
      sustainsLiveSermon: !modelAvailable || (viability?.viable ?? true),
      capacityNote: viability && !viability.viable ? viability.detail : undefined,
      freeTierDisclosure,
    },
    bible: {
      configured: bible,
      textAvailable,
      translation: env.bible.translation,
    },
    counter: {
      provider: counterCaps?.label ?? null,
      mayTrain: counterProvider
        ? trainsOnSubmissions(counterProvider, env.llm.paidTier.has(counterProvider), {
            openRouterDeniesCollection: denies,
          })
        : false,
      note: counterCaps?.privacyNote ?? "",
      openWeightModel: counterProvider
        ? OPEN_WEIGHT(counterProvider, env.llm.providers[counterProvider].model)
        : false,
    },
  };

  return NextResponse.json(config);
}
