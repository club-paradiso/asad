/**
 * Context intelligence.
 *
 * ASAD used to ask a question it had no business asking: "sermon or general?"
 * The interpreter knows the answer, but so does the speech — and asking meant
 * a wrong choice stayed wrong for the whole session, a right choice had to be
 * remade every time, and the product carried two of everything to serve it.
 *
 * This module replaces that fork. `ContextMode` is what the USER may say
 * ("auto", or an override); `ResolvedContext` is what the system decides and
 * what every downstream consumer reads. The default is `auto` and the expected
 * case is that nobody ever touches it.
 *
 * SIX SIGNAL FAMILIES, none of which is trusted alone:
 *
 *  1. structure     — Scripture references resolved by the existing detector.
 *                     Deterministic, language-independent, and the single
 *                     strongest worship signal there is.
 *  2. terminology   — how densely the domain lexicons actually match. This is
 *                     the glossary matcher the engine already runs, not a
 *                     second keyword list bolted on beside it.
 *  3. discourse     — the rhetorical shape of the speech: direct address to a
 *                     room, agenda language, question-and-answer turn taking.
 *  4. metadata      — the prep sheet. A venue called "…교회" or a named main
 *                     passage is evidence before a word is spoken.
 *  5. model         — the interpretation model's own read, carried back in the
 *                     `context` field of a response it was going to send
 *                     anyway. NO EXTRA CALL IS EVER MADE FOR THIS.
 *  6. incumbency    — what the session already decided. Context does not
 *                     flicker: a challenger must clear the incumbent by a
 *                     margin, not merely tie it.
 *
 * Everything here is pure and synchronous so the rules can be tested without a
 * clock, a network or a model.
 */
import type { ContextMode, PrepSheet, ResolvedContext } from "@/types";

export type { ContextMode, ResolvedContext };

export const CONTEXT_MODES: ContextMode[] = [
  "auto",
  "worship",
  "lecture",
  "meeting",
  "conversation",
  "event",
];

export const RESOLVED_CONTEXTS: ResolvedContext[] = [
  "worship",
  "lecture",
  "meeting",
  "conversation",
  "event",
  "generic",
];

export const isContextMode = (value: unknown): value is ContextMode =>
  typeof value === "string" && (CONTEXT_MODES as string[]).includes(value);

export const isResolvedContext = (value: unknown): value is ResolvedContext =>
  typeof value === "string" && (RESOLVED_CONTEXTS as string[]).includes(value);

/** A manual override resolves to itself; `auto` resolves to whatever was inferred. */
export const contextFromMode = (
  mode: ContextMode,
  inferred: ResolvedContext,
): ResolvedContext => (mode === "auto" ? inferred : mode);

/* --------------------------------------------------------------------------
 * Signals
 * ------------------------------------------------------------------------ */

type Scores = Record<ResolvedContext, number>;

const zeroScores = (): Scores => ({
  worship: 0,
  lecture: 0,
  meeting: 0,
  conversation: 0,
  event: 0,
  generic: 0,
});

/**
 * Discourse patterns, per context, in the two languages the product ships
 * strongest — plus the language-independent shapes.
 *
 * These are ONE family of six, and the weakest-weighted of the four textual
 * ones. They exist to separate contexts the terminology signal cannot: a
 * lecture and a meeting share almost all their vocabulary and differ almost
 * entirely in who is allowed to speak.
 */
interface DiscoursePattern {
  context: ResolvedContext;
  pattern: RegExp;
  weight: number;
}

const DISCOURSE: DiscoursePattern[] = [
  // Worship — address to a room that is expected to answer, and the speech
  // acts that only happen in a service.
  { context: "worship", pattern: /아멘|할렐루야|주님|하나님|기도하겠습니다|찬양|축복|성도\s*여러분/u, weight: 3 },
  { context: "worship", pattern: /\bamen\b|\bhallelujah\b|\blet us pray\b|\bthe lord\b|\bcongregation\b/iu, weight: 3 },
  { context: "worship", pattern: /장\s*\d+\s*절|말씀|성경|복음서/u, weight: 2 },

  // Lecture — one speaker teaching a structured body of material.
  { context: "lecture", pattern: /오늘\s*강의|이번\s*시간(에|에는)|다음\s*장|슬라이드|정리하자면|과제|수강생|학생\s*여러분/u, weight: 3 },
  { context: "lecture", pattern: /\btoday'?s lecture\b|\bnext slide\b|\bin this (?:session|chapter)\b|\bthe syllabus\b|\byour assignment\b/iu, weight: 3 },
  { context: "lecture", pattern: /첫째|둘째|셋째|요약하면/u, weight: 1 },

  // Meeting — an agenda, decisions, and people being assigned things.
  { context: "meeting", pattern: /안건|회의록|의결|다음\s*안건|액션\s*아이템|담당자|일정\s*조율|보고드리겠습니다|검토하겠습니다/u, weight: 3 },
  { context: "meeting", pattern: /\bagenda\b|\baction items?\b|\bminutes\b|\bfollow[- ]?up\b|\bnext steps\b|\bwho(?:'s| is) taking\b|\bdeadline\b/iu, weight: 3 },
  { context: "meeting", pattern: /분기|예산|일정표|승인/u, weight: 1 },

  // Conversation — two people, short turns, questions back and forth.
  { context: "conversation", pattern: /그쪽|혹시\s*어떻게|여쭤볼게요|말씀해\s*주세요|성함이|어떻게\s*도와드릴까요/u, weight: 3 },
  { context: "conversation", pattern: /\bhow can i help\b|\bcould you tell me\b|\bmay i ask\b|\byour name\b|\bone moment please\b/iu, weight: 3 },

  // Event — a programme being run from a stage.
  { context: "event", pattern: /내빈|사회를\s*맡은|다음\s*순서|박수로\s*맞이|환영합니다|축사|개회|폐회/u, weight: 3 },
  { context: "event", pattern: /\bwelcome everyone\b|\bour next (?:speaker|item)\b|\bplease join me in welcoming\b|\bopening remarks\b|\bthank you all for coming\b/iu, weight: 3 },
];

/** Prep-sheet metadata evidence, available before a word is spoken. */
const METADATA: DiscoursePattern[] = [
  { context: "worship", pattern: /교회|성당|선교|목사|전도사|장로|예배|church|chapel|ministry|parish|pastor|worship/iu, weight: 4 },
  { context: "lecture", pattern: /대학|학교|강의|세미나|아카데미|university|college|lecture|seminar|course|academy/iu, weight: 3 },
  { context: "meeting", pattern: /회의|이사회|주주|워크숍|board|meeting|committee|standup|retrospective/iu, weight: 3 },
  { context: "event", pattern: /컨퍼런스|포럼|시상식|개막|축제|conference|forum|ceremony|festival|summit|gala/iu, weight: 3 },
];

/**
 * How strongly the pending text reads as one context, from text alone.
 *
 * Exported so the weighting can be tested against real transcript rather than
 * inferred from the resolver's output.
 */
export function discourseScores(text: string): Scores {
  const scores = zeroScores();
  if (!text.trim()) return scores;
  for (const signal of DISCOURSE) {
    if (signal.pattern.test(text)) scores[signal.context] += signal.weight;
  }

  // Language-independent shape. A high question density with short turns is
  // conversation; long uninterrupted declaratives are not.
  const sentences = text.split(/[.!?。？！\n]+/u).filter((part) => part.trim().length > 1);
  if (sentences.length >= 3) {
    const questions = sentences.filter((part) => /[?？]|까요|나요|습니까/u.test(part)).length;
    const averageLength =
      sentences.reduce((sum, part) => sum + part.trim().length, 0) / sentences.length;
    if (questions / sentences.length >= 0.4) scores.conversation += 2;
    if (averageLength >= 60) {
      scores.lecture += 1;
      scores.worship += 1;
    }
  }

  return scores;
}

export function metadataScores(prep: PrepSheet | undefined): Scores {
  const scores = zeroScores();
  const corpus = [prep?.organisation, prep?.title, prep?.notes, prep?.outline]
    .filter((value): value is string => !!value?.trim())
    .join("\n");
  if (prep?.scripture?.trim()) scores.worship += 4;
  if (!corpus) return scores;
  for (const signal of METADATA) {
    if (signal.pattern.test(corpus)) scores[signal.context] += signal.weight;
  }
  return scores;
}

/* --------------------------------------------------------------------------
 * The resolver
 * ------------------------------------------------------------------------ */

/** Characters of recent speech the resolver reasons over. */
export const CONTEXT_WINDOW_CHARS = 1_200;
/**
 * Nothing is inferred from a greeting. Below this the session is `generic`,
 * which is also what `generic` means: not enough evidence to specialise.
 */
export const CONTEXT_MIN_CHARS = 140;
/** A challenger must beat the incumbent by this much to take over. */
export const CONTEXT_SWITCH_MARGIN = 3;
/** Below this the top score is noise, whatever it is. */
export const CONTEXT_MIN_SCORE = 4;

export interface ContextState {
  /** What the user asked for. */
  mode: ContextMode;
  /** What the signals say, independent of the override. */
  inferred: ResolvedContext;
  /** What everything downstream should use. */
  resolved: ResolvedContext;
  /** 0–1. Low confidence means "degrade gracefully", not "guess harder". */
  confidence: number;
  /** True while the resolver has not seen enough speech to specialise. */
  warmingUp: boolean;
}

export interface ContextObservation {
  /** Newly stabilised source-language text. */
  text?: string;
  /** Scripture references the local detector resolved in this text. */
  scriptureHits?: number;
  /** Domain terminology the glossary matcher found in this text. */
  worshipTermHits?: number;
  /** The interpretation model's own read, from a response it already sent. */
  modelHint?: ResolvedContext;
}

/**
 * Rolling context inference for one session.
 *
 * Stateful on purpose: context is a property of the session, not of a
 * sentence, and the incumbency rule needs somewhere to live.
 */
export class ContextResolver {
  private mode: ContextMode;
  private prep: PrepSheet | undefined;
  private window = "";
  private observed = 0;
  private scripture = 0;
  private worshipTerms = 0;
  private modelVotes: Partial<Record<ResolvedContext, number>> = {};
  private inferred: ResolvedContext = "generic";
  private confidenceValue = 0;

  constructor(options: { mode?: ContextMode; prep?: PrepSheet } = {}) {
    this.mode = options.mode ?? "auto";
    this.prep = options.prep;
  }

  /** The user's override, or `auto`. Changing it never discards evidence. */
  setMode(mode: ContextMode): void {
    this.mode = mode;
  }

  setPrep(prep: PrepSheet | undefined): void {
    this.prep = prep;
  }

  /**
   * Fold one observation in. Returns true when the RESOLVED context changed,
   * which is the only event a caller has to act on.
   */
  observe(observation: ContextObservation): boolean {
    const before = this.state().resolved;

    if (observation.text?.trim()) {
      this.window = `${this.window} ${observation.text.trim()}`.slice(-CONTEXT_WINDOW_CHARS);
      this.observed += observation.text.trim().length;
    }
    this.scripture += observation.scriptureHits ?? 0;
    this.worshipTerms += observation.worshipTermHits ?? 0;
    if (observation.modelHint) {
      this.modelVotes[observation.modelHint] = (this.modelVotes[observation.modelHint] ?? 0) + 1;
    }

    this.recompute();
    return this.state().resolved !== before;
  }

  private recompute(): void {
    const scores = zeroScores();
    const metadata = metadataScores(this.prep);
    const discourse = discourseScores(this.window);

    for (const context of RESOLVED_CONTEXTS) {
      scores[context] = metadata[context] + discourse[context];
    }

    // Structure: Scripture references are the strongest single worship signal
    // and the only one that cannot be produced by vocabulary alone.
    scores.worship += Math.min(9, this.scripture * 3);
    // Terminology: density rather than count, so a long session does not drift
    // into worship merely by running long.
    const per1k = this.observed > 0 ? (this.worshipTerms * 1000) / this.observed : 0;
    scores.worship += Math.min(5, per1k);

    // The model's read. Weighted highest of the textual families because it is
    // the only one that read the sentence rather than matched it — but it is
    // still one vote among six, and it cannot on its own clear the switch
    // margin against a settled incumbent.
    for (const [context, votes] of Object.entries(this.modelVotes)) {
      if (isResolvedContext(context)) scores[context] += Math.min(8, (votes ?? 0) * 2);
    }

    const ranked = RESOLVED_CONTEXTS.filter((context) => context !== "generic")
      .map((context) => ({ context, score: scores[context] }))
      .sort((a, b) => b.score - a.score);

    const leader = ranked[0];
    const runnerUp = ranked[1];

    if (this.observed < CONTEXT_MIN_CHARS && Object.keys(this.modelVotes).length === 0) {
      // Metadata alone may still specialise before anyone speaks — that is the
      // prep sheet doing its job — but it has to be unambiguous about it.
      const metadataLeader = RESOLVED_CONTEXTS.filter((c) => c !== "generic")
        .map((context) => ({ context, score: metadata[context] }))
        .sort((a, b) => b.score - a.score)[0];
      if (metadataLeader.score >= CONTEXT_MIN_SCORE) {
        this.inferred = metadataLeader.context;
        this.confidenceValue = 0.4;
      } else {
        this.inferred = "generic";
        this.confidenceValue = 0;
      }
      return;
    }

    if (!leader || leader.score < CONTEXT_MIN_SCORE) {
      this.inferred = "generic";
      this.confidenceValue = 0;
      return;
    }

    const margin = leader.score - (runnerUp?.score ?? 0);
    const incumbent = this.inferred;
    const holds =
      incumbent !== "generic" &&
      incumbent !== leader.context &&
      leader.score - scores[incumbent] < CONTEXT_SWITCH_MARGIN;

    if (!holds) this.inferred = leader.context;

    // Confidence is about how clearly the leader won, not how loud it was.
    const spread = leader.score === 0 ? 0 : margin / leader.score;
    this.confidenceValue = Math.max(0, Math.min(1, 0.35 + spread * 0.65));
  }

  state(): ContextState {
    const resolved = contextFromMode(this.mode, this.inferred);
    return {
      mode: this.mode,
      inferred: this.inferred,
      resolved,
      // A manual override is the user telling us; that is certainty by
      // definition, and it must not be reported as a low-confidence guess.
      confidence: this.mode === "auto" ? this.confidenceValue : 1,
      warmingUp: this.mode === "auto" && this.inferred === "generic" && this.observed < CONTEXT_MIN_CHARS,
    };
  }
}

/* --------------------------------------------------------------------------
 * Display
 * ------------------------------------------------------------------------ */

export const CONTEXT_LABEL_EN: Record<ResolvedContext, string> = {
  worship: "Worship",
  lecture: "Lecture",
  meeting: "Meeting",
  conversation: "Conversation",
  event: "Event",
  generic: "General",
};

export const CONTEXT_LABEL_KO: Record<ContextMode, string> = {
  auto: "자동",
  worship: "예배·설교",
  lecture: "강연",
  meeting: "회의",
  conversation: "대화",
  event: "행사",
};

export const RESOLVED_CONTEXT_LABEL_KO: Record<ResolvedContext, string> = {
  worship: "예배·설교",
  lecture: "강연",
  meeting: "회의",
  conversation: "대화",
  event: "행사",
  generic: "일반",
};

/**
 * Whether this context should receive worship-specific treatment — Scripture
 * normalisation, theological register, the community glossary, the recogniser's
 * sermon keyterms.
 *
 * One predicate, read by every consumer, so "is this a sermon?" is answered in
 * exactly one place instead of eleven.
 */
export const isWorshipContext = (context: ResolvedContext): boolean => context === "worship";
