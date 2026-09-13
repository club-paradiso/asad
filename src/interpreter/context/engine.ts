/**
 * The Context Engine.
 *
 * Decides what kind of room the interpreter is in — a service, a lecture, a
 * board meeting, a conversation — from evidence, so nobody has to choose a
 * "mode" before the speaker starts. The answer is a `ResolvedDomain`; the
 * prompt/lexicon layer follows from it via `layerForDomain`.
 *
 * Deliberately deterministic and cheap: no model call, no network, pure
 * functions over a small state. It runs on every newly stable unit and must
 * cost nothing the interpreter can feel.
 *
 * Evidence classes, roughly in order of strength:
 *   scripture      a Bible reference was spoken               → sermon, some worship
 *   preaching      본문 / 설교 / "the passage" / 經文           → sermon
 *   liturgy        하나님 / 아멘 / "let us pray" / 禱告          → worship
 *   theology       lexicon vocabulary (칭의, grace, 恩典 …)     → worship + sermon
 *   lecture        다음 장 / 시험 / "next slide" / 考試         → lecture
 *   meeting        안건 / KPI / "action item" / 議程            → meeting
 *   presentation   발표 / 데모 / "roadmap" / 簡報               → presentation
 *   event          환영합니다 / 시상 / "next up" / 頒獎          → event
 *   conversation   short turns, questions, 반말, second person  → conversation (weak)
 *   prep           a prep sheet with Scripture or a church venue → worship prior
 *   topic          the model's own topic label                  → whichever it names
 *
 * Scores decay by 0.9 per unit so the domain can drift with the room, and a
 * switch away from an established domain needs a challenger that clearly
 * leads (margin 1.5) on at least two units of support — one stray "amen" in a
 * budget review must not turn on the sermon layer. Below 1.0 total evidence
 * nothing is claimed and the domain is `generic`.
 *
 * A manual override always wins, at confidence 1. It is the interpreter's
 * call and the engine keeps scoring underneath it so lifting the override
 * lands on the evidence, not on a blank.
 */
import type {
  ContextDomain,
  DomainInference,
  EntityKind,
  PrepSheet,
  ResolvedDomain,
} from "@/types";
import { RESOLVED_DOMAINS } from "@/types";
import { languageBase } from "@/languages/registry";
import { detectScriptureReferences } from "../scripture/detect";
import { THEOLOGICAL_LEXICON } from "../glossary/lexicon";
import { findWholeWordOccurrences } from "../glossary/match-korean";

export interface ContextEvidence {
  /** One newly stable unit of source text. */
  stableText?: string;
  /** The model's own topic label from the last turn, when it gave one. */
  topic?: string;
  /** The prep sheet, when first seen. Counted once per call; pass it once. */
  prep?: PrepSheet;
  /** Scripture references the caller already detected in this unit. */
  scriptureCount?: number;
  /** Lexicon term keys the glossary matcher hit in this unit. */
  glossaryHits?: string[];
  /** Kinds of entities resolved in this unit. */
  entityKinds?: EntityKind[];
  /** Source language of `stableText`, any tag the registry resolves. */
  language: string;
}

export interface ContextEngineState {
  scores: Record<ResolvedDomain, number>;
  manual: ContextDomain;
  inference: DomainInference;
  unitsSeen: number;
  /**
   * Consecutive recent units in which each domain drew transcript evidence.
   * Hysteresis reads it; nothing else does.
   */
  support: Record<ResolvedDomain, number>;
  /** Evidence labels per domain, oldest first, bounded. Never transcript. */
  signals: Record<ResolvedDomain, string[]>;
  /** True once any observed unit contributed evidence (as opposed to the prep prior). */
  observedEvidence: boolean;
}

/* --------------------------------------------------------------------------
 * Tuning. Numbers, not opinions: every one is exercised by engine.test.ts.
 * ------------------------------------------------------------------------ */

/** Per-unit decay, so a domain established ten minutes ago can be overtaken. */
export const DECAY = 0.9;
/** A challenger must lead the established domain by this much... */
export const HYSTERESIS_MARGIN = 1.5;
/** ...on at least this many consecutive units of its own evidence. */
export const MIN_SUPPORT_UNITS = 2;
/** Total evidence below which nothing is claimed. */
export const DEFAULT_THRESHOLD = 1.0;
export const MAX_CONFIDENCE = 0.95;
export const DEFAULT_CONFIDENCE = 0.35;
/** Total evidence at which the winner's share is fully trusted. */
const SATURATION = 3;
const MAX_SIGNALS = 6;

/* --------------------------------------------------------------------------
 * Vocabulary. Korean terms are matched whole-word through the same matcher
 * the glossary uses; CJK terms by substring (no word boundaries to respect);
 * Latin terms by Unicode word boundary, case-insensitively.
 * ------------------------------------------------------------------------ */

type Weighted = readonly [term: string, weight?: number];

const PREACHING: Weighted[] = [
  ["말씀"], ["본문"], ["설교"], ["봉독"], ["말씀하십니다", 0.5],
  ["sermon"], ["passage"], ["verse"], ["the text says"], ["scripture"],
  ["经文"], ["經文"], ["讲道"], ["講道"], ["证道"], ["證道"],
];

const LITURGY: Weighted[] = [
  ["하나님"], ["주님"], ["기도합니다"], ["기도하겠습니다"], ["아멘"], ["할렐루야"],
  ["찬양"], ["예배"], ["축도"], ["성도 여러분"],
  ["let us pray"], ["amen"], ["hallelujah"], ["praise the lord"], ["worship"],
  ["hymn"], ["congregation"], ["in jesus' name"],
  ["阿门"], ["阿們"], ["祷告"], ["禱告"], ["敬拜"], ["赞美"], ["讚美"],
  ["哈利路亚"], ["哈利路亞"], ["会众"], ["會眾"], ["弟兄姊妹"],
];

/** English and Chinese theological vocabulary; the Korean list is the lexicon itself. */
const THEOLOGY: Weighted[] = [
  ["grace"], ["gospel"], ["salvation"], ["justification"], ["sanctification"],
  ["covenant"], ["atonement"], ["resurrection"], ["the cross"], ["holy spirit"],
  ["prayer"], ["blessing"], ["disciple"], ["repentance"],
  ["恩典"], ["福音"], ["救恩"], ["称义"], ["稱義"], ["成圣"], ["成聖"],
  ["圣灵"], ["聖靈"], ["十字架"], ["复活"], ["復活"], ["悔改"], ["门徒"], ["門徒"],
  ["教会"], ["教會"], ["上帝"], ["耶稣"], ["耶穌"],
];

const LECTURE: Weighted[] = [
  ["다음 장"], ["시험"], ["교재"], ["슬라이드", 0.7], ["과제"], ["강의"], ["수업"], ["교수님"],
  ["next slide", 0.7], ["chapter"], ["exam"], ["homework"], ["lecture"], ["syllabus"],
  ["textbook"], ["assignment"],
  ["下一章"], ["考试"], ["考試"], ["教材"], ["作业"], ["作業"], ["课程"], ["課程"],
  ["讲义"], ["講義"], ["同学们"], ["同學們"],
];

const MEETING: Weighted[] = [
  ["안건"], ["회의"], ["결정"], ["담당자"], ["분기"], ["KPI"], ["예산"], ["보고드리겠습니다"],
  ["agenda"], ["action item"], ["quarter"], ["budget"], ["minutes"], ["stakeholder"],
  ["deadline"], ["headcount"],
  ["议程"], ["議程"], ["会议"], ["會議"], ["预算"], ["預算"], ["季度"],
  ["负责人"], ["負責人"], ["决定"], ["決定"],
];

const PRESENTATION: Weighted[] = [
  ["발표"], ["슬라이드", 0.7], ["데모"], ["로드맵"], ["출시"],
  ["demo"], ["roadmap"], ["launch"], ["slide deck"], ["next slide", 0.7], ["our product"],
  ["演示"], ["路线图"], ["路線圖"], ["发布"], ["發布"], ["简报"], ["簡報"], ["产品"], ["產品"],
];

const EVENT: Weighted[] = [
  ["환영합니다"], ["순서"], ["시상"], ["사회자"], ["축사"], ["개회"],
  ["welcome everyone"], ["next up"], ["award"], ["ceremony"], ["please welcome"],
  ["欢迎"], ["歡迎"], ["颁奖"], ["頒獎"], ["下一位"], ["典礼"], ["典禮"],
];

const CONVERSATION_SECOND_PERSON = /(^|[\s,.!?])(너|니가|네가|당신|너희)(?=[\s,.!?가는를이의도한테에게]|$)|\b(you|tú|你|您)\b/u;
const KOREAN_QUESTION_ENDING = /(니|냐|나요|까요|까|어요|죠)\s*\?$/u;

const THEOLOGY_KO = new Set(THEOLOGICAL_LEXICON.map((item) => item.korean));

const CHURCH_VENUE = /교회|성당|church|chapel|cathedral|教会|教會|礼拜堂|禮拜堂/i;
const ENGLISH_REFERENCE = /\b(?:[1-3]\s?)?[A-Z][a-z]{2,}\.?\s\d{1,3}:\d{1,3}\b/g;
const CHINESE_REFERENCE = /[一-鿿]{1,6}\s?(?:第?\d{1,3}|[一二三四五六七八九十百]{1,4})\s?章\s?(?:第?\d{1,3}|[一二三四五六七八九十百]{1,4})\s?[节節]/g;

/* --------------------------------------------------------------------------
 * Matching
 * ------------------------------------------------------------------------ */

const HANGUL = /[가-힣]/;
const CJK = /[一-鿿]/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Occurrences of one term, matched the way its script needs. */
function countTerm(text: string, term: string): number {
  if (HANGUL.test(term)) return findWholeWordOccurrences(text, term).length;
  if (CJK.test(term)) {
    let count = 0;
    for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + term.length)) count += 1;
    return count;
  }
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, "giu");
  return text.match(re)?.length ?? 0;
}

/** Sum of weights for every listed term present, capped so a list cannot run away on one unit. */
function scoreList(text: string, list: Weighted[], cap: number): number {
  let total = 0;
  for (const [term, weight = 1] of list) {
    const hits = countTerm(text, term);
    if (hits > 0) total += weight * Math.min(hits, 2);
    if (total >= cap) return cap;
  }
  return total;
}

function scriptureReferences(text: string, language: string): number {
  if (languageBase(language) === "ko") return detectScriptureReferences(text).length;
  const english = text.match(ENGLISH_REFERENCE)?.length ?? 0;
  const chinese = text.match(CHINESE_REFERENCE)?.length ?? 0;
  return english + chinese;
}

/* --------------------------------------------------------------------------
 * Evidence → contributions
 * ------------------------------------------------------------------------ */

interface Contribution {
  domain: ResolvedDomain;
  weight: number;
  signal: string;
}

function textContributions(text: string, evidence: ContextEvidence): Contribution[] {
  const out: Contribution[] = [];
  const add = (domain: ResolvedDomain, weight: number, signal: string) => {
    if (weight > 0) out.push({ domain, weight, signal });
  };

  // (a) Scripture — the strongest single signal there is.
  const refs = Math.max(scriptureReferences(text, evidence.language), evidence.scriptureCount ?? 0);
  if (refs > 0) {
    add("sermon", 3 + Math.min(refs - 1, 3) * 0.5, "scripture");
    add("worship", 1, "scripture");
  }

  // (b) Theological vocabulary: Korean via the lexicon, others via the list.
  let theology = 0;
  const seen = new Set<string>();
  if (languageBase(evidence.language) === "ko") {
    for (const term of THEOLOGY_KO) {
      if (theology >= 4) break;
      if (countTerm(text, term) > 0) {
        seen.add(term);
        theology += 1;
      }
    }
  }
  for (const key of evidence.glossaryHits ?? []) {
    if (theology >= 4) break;
    if (THEOLOGY_KO.has(key) && !seen.has(key)) {
      seen.add(key);
      theology += 1;
    }
  }
  theology += scoreList(text, THEOLOGY, 4 - Math.min(theology, 4));
  if (theology > 0) {
    add("worship", theology * 0.5, "theology-lexicon");
    add("sermon", theology * 0.5, "theology-lexicon");
  }

  // (c) Prayer, address and liturgy.
  const liturgy = scoreList(text, LITURGY, 3);
  if (liturgy > 0) {
    add("worship", liturgy, "liturgy");
    add("sermon", liturgy * 0.3, "liturgy");
  }
  const preaching = scoreList(text, PREACHING, 3);
  if (preaching > 0) {
    add("sermon", preaching, "preaching");
    add("worship", preaching * 0.3, "preaching");
  }

  // (d)–(g) Secular rooms.
  add("lecture", scoreList(text, LECTURE, 3), "lecture-markers");
  add("meeting", scoreList(text, MEETING, 3), "meeting-markers");
  add("presentation", scoreList(text, PRESENTATION, 3), "presentation-markers");
  add("event", scoreList(text, EVENT, 3), "event-markers");

  // (h) Conversation: weak, cumulative, easily outweighed by any real content.
  const trimmed = text.trim();
  let conversation = 0;
  const short = HANGUL.test(trimmed) || CJK.test(trimmed)
    ? trimmed.length < 25
    : trimmed.split(/\s+/).length < 8;
  if (short) conversation += 0.4;
  if (/\?\s*$/.test(trimmed) || KOREAN_QUESTION_ENDING.test(trimmed)) conversation += 0.3;
  if (CONVERSATION_SECOND_PERSON.test(trimmed)) conversation += 0.4;
  add("conversation", Math.min(conversation, 1.2), "turn-taking");

  // Entities say a little about the room and nothing about the content.
  for (const kind of new Set(evidence.entityKinds ?? [])) {
    if (kind === "organisation") {
      add("meeting", 0.3, "entities");
      add("presentation", 0.2, "entities");
    } else if (kind === "work") add("lecture", 0.3, "entities");
    else if (kind === "place") add("event", 0.2, "entities");
  }

  return out;
}

/** (j) The model's own label, matched against the same vocabulary. */
function topicContributions(topic: string): Contribution[] {
  const out: Contribution[] = [];
  const lists: Array<[ResolvedDomain, Weighted[]]> = [
    ["worship", LITURGY],
    ["worship", THEOLOGY],
    ["sermon", PREACHING],
    ["lecture", LECTURE],
    ["meeting", MEETING],
    ["presentation", PRESENTATION],
    ["event", EVENT],
  ];
  const hit = new Set<ResolvedDomain>();
  for (const [domain, list] of lists) {
    if (hit.has(domain)) continue;
    if (scoreList(topic, list, 1) > 0 || (domain === "sermon" && scriptureReferences(topic, "en") > 0)) {
      hit.add(domain);
      out.push({ domain, weight: 0.8, signal: "topic" });
    }
  }
  return out;
}

/** (i) The prep sheet as a prior. */
function prepContributions(prep: PrepSheet): Contribution[] {
  const out: Contribution[] = [];
  if (prep.scripture?.trim()) out.push({ domain: "worship", weight: 2, signal: "prep:scripture" });
  if (prep.organisation && CHURCH_VENUE.test(prep.organisation)) {
    out.push({ domain: "worship", weight: 1.5, signal: "prep:organisation" });
  }
  if (prep.title && (scoreList(prep.title, LITURGY, 1) > 0 || scoreList(prep.title, THEOLOGY, 1) > 0)) {
    out.push({ domain: "worship", weight: 0.5, signal: "prep:title" });
  }
  return out;
}

/* --------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------ */

function table<T>(value: () => T): Record<ResolvedDomain, T> {
  const out = {} as Record<ResolvedDomain, T>;
  for (const domain of RESOLVED_DOMAINS) out[domain] = value();
  return out;
}

const zeroes = () => table(() => 0);
const emptySignals = () => table<string[]>(() => []);

const DEFAULT_INFERENCE: DomainInference = {
  domain: "generic",
  confidence: DEFAULT_CONFIDENCE,
  source: "default",
  signals: [],
};

export function createContextEngine(options: {
  manual: ContextDomain;
  prep?: PrepSheet;
  language: string;
}): ContextEngineState {
  const base: ContextEngineState = {
    scores: zeroes(),
    manual: options.manual,
    inference: DEFAULT_INFERENCE,
    unitsSeen: 0,
    support: zeroes(),
    signals: emptySignals(),
    observedEvidence: false,
  };
  const seeded = options.prep ? apply(base, prepContributions(options.prep), false) : base;
  return { ...seeded, inference: resolve(seeded) };
}

/** Fold contributions into a copy of the state. `unit` says whether this counts as an observed unit. */
function apply(state: ContextEngineState, contributions: Contribution[], unit: boolean): ContextEngineState {
  const scores = { ...state.scores };
  const support = { ...state.support };
  const signals = { ...state.signals };
  const touched = new Set<ResolvedDomain>();

  if (unit) for (const domain of RESOLVED_DOMAINS) scores[domain] *= DECAY;

  for (const { domain, weight, signal } of contributions) {
    scores[domain] += weight;
    touched.add(domain);
    if (!signals[domain].includes(signal)) {
      signals[domain] = [...signals[domain], signal].slice(-MAX_SIGNALS);
    }
  }

  if (unit) {
    for (const domain of RESOLVED_DOMAINS) {
      support[domain] = touched.has(domain) ? support[domain] + 1 : 0;
    }
  }

  return {
    ...state,
    scores,
    support,
    signals,
    unitsSeen: state.unitsSeen + (unit ? 1 : 0),
    observedEvidence: state.observedEvidence || (unit && touched.size > 0),
  };
}

/** Turn scores into an inference, honouring the override and the hysteresis. */
function resolve(state: ContextEngineState): DomainInference {
  if (state.manual !== "auto") {
    return { domain: state.manual, confidence: 1, source: "manual", signals: ["manual"] };
  }

  const total = RESOLVED_DOMAINS.reduce((sum, domain) => sum + state.scores[domain], 0);
  if (total <= DEFAULT_THRESHOLD) return DEFAULT_INFERENCE;

  let winner: ResolvedDomain = "generic";
  for (const domain of RESOLVED_DOMAINS) {
    if (state.scores[domain] > state.scores[winner]) winner = domain;
  }

  // Hysteresis: an established domain is only overtaken by a clear, sustained lead.
  const previous = state.inference;
  const established = previous.source === "inferred" || previous.source === "prep";
  let chosen = winner;
  if (established && previous.domain !== winner && previous.domain !== "generic") {
    const leads = state.scores[winner] > state.scores[previous.domain] + HYSTERESIS_MARGIN;
    const sustained = state.support[winner] >= MIN_SUPPORT_UNITS;
    if (!leads || !sustained) chosen = previous.domain;
  }

  const share = state.scores[chosen] / total;
  const strength = Math.min(1, total / SATURATION);
  const confidence = Math.max(DEFAULT_CONFIDENCE, Math.min(MAX_CONFIDENCE, share * strength));

  return {
    domain: chosen,
    confidence: Number(confidence.toFixed(3)),
    source: state.observedEvidence ? "inferred" : "prep",
    signals: [...state.signals[chosen]],
  };
}

/** Observe one unit of evidence. Pure: returns the next state, never mutates. */
export function observe(state: ContextEngineState, evidence: ContextEvidence): ContextEngineState {
  const contributions: Contribution[] = [];
  const unit = typeof evidence.stableText === "string";

  if (evidence.prep) contributions.push(...prepContributions(evidence.prep));
  if (unit) contributions.push(...textContributions(evidence.stableText ?? "", evidence));
  else if (evidence.scriptureCount) {
    contributions.push({ domain: "sermon", weight: 3, signal: "scripture" });
    contributions.push({ domain: "worship", weight: 1, signal: "scripture" });
  }
  if (evidence.topic?.trim()) contributions.push(...topicContributions(evidence.topic));

  const next = apply(state, contributions, unit);
  return { ...next, inference: resolve(next) };
}

/** Set or lift the interpreter's override. Scores are untouched underneath it. */
export function setManualContext(state: ContextEngineState, manual: ContextDomain): ContextEngineState {
  const next = { ...state, manual };
  return { ...next, inference: resolve(next) };
}

export const currentDomain = (state: ContextEngineState): DomainInference => state.inference;
