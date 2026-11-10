/**
 * Administrative semantic integrity checks.
 *
 * The numeric validator (`../integrity.ts`) proves dates, amounts and codes
 * survived. It cannot see that "you MUST report" came out as "you MAY report",
 * that an application became an approval, or that a residence status became a
 * residence card. Those are the errors this file looks for.
 *
 * Deliberately independent of the translating model: everything here is
 * deterministic cue lexicons plus the concept registry. That makes it blind to
 * paraphrase it has no cue for — it can miss errors, and the benchmark reports
 * how often on its own corpus — but it cannot be talked into agreeing with the
 * model that produced the translation.
 *
 * When a language pair has no lexicon the result is `unsupported`, never a
 * silent pass.
 */
import { findConcept, registryLanguage } from "./registry";
import { conceptMentionedAnywhere, matchConcepts } from "./matcher";
import type { RegistryLanguage } from "./types";

export type SemanticCategory =
  | "modality"
  | "procedure-concept"
  | "conditional"
  | "completion"
  | "certainty"
  | "actor"
  | "invented-instruction";

export type SemanticSeverity = "critical" | "high" | "medium" | "low";

export interface SemanticIssue {
  category: SemanticCategory;
  /** Stable identifier of the check, e.g. "obligation-to-permission". */
  check: string;
  severity: SemanticSeverity;
  sourceEvidence?: string;
  targetEvidence?: string;
  /** Korean, for staff. */
  message: string;
}

export interface SemanticIntegrity {
  status: "checked" | "partial" | "unsupported";
  checked: SemanticCategory[];
  unchecked: SemanticCategory[];
  issues: SemanticIssue[];
}

type Cue = string | RegExp;
type CueSet =
  | "prohibition"
  | "obligation"
  | "permission"
  | "hedge"
  | "conditional"
  | "pending"
  | "completed"
  | "directive"
  | "first"
  | "second"
  /** Spans that look like cues but are not (question tags). Masked first, never reported. */
  | "ignore";

type Lexicon = Partial<Record<CueSet, readonly Cue[]>>;

/* -------------------------------------------------------------------------- */
/* Lexicons                                                                   */
/* -------------------------------------------------------------------------- */

const KO: Lexicon = {
  prohibition: ["안 됩니다", "안 돼요", "안 돼", "안됩니다", "안돼요", "안돼", "할 수 없", "하실 수 없", "수 없습니다", "수 없어요", "수 없", "금지", "불가능", "불가합니다", "불가해요", "하지 마", "마세요", "마십시오", "말아 주세요"],
  obligation: ["해야", "하셔야", "셔야", "어야", "아야", "여야", "필수", "반드시", "꼭 ", "의무", "받아야", "내야", "필요합니다", "필요해요", "필요하", "필요"],
  permission: ["해도 됩니다", "해도 돼", "도 됩니다", "도 돼요", "도 돼", "도 괜찮", "가능합니다", "가능해요", "가능하", "할 수 있", "하실 수 있", "수 있습니다", "수 있어요", "수 있", "허용", "면 됩니다", "면 돼요", "면 돼"],
  hedge: ["아마", "것 같", "거 같", "수도 있", "듯합니다", "듯해요", "확실하지", "잘 모르겠", "글쎄"],
  conditional: ["경우", "만약", "다면", "으면", "하면", "시면", "라면", "거든", "면 "],
  pending: ["심사 중", "심사중", "처리 중", "처리중", "진행 중", "진행중", "검토 중", "검토중", "아직", "대기 중", "대기중", "예정"],
  completed: ["완료", "끝났", "마쳤", "처리됐", "처리되었", "발급됐", "발급되었", "이미"],
  directive: ["주세요", "하세요", "십시오", "세요", "주시겠", "주실래"],
  first: ["저희가", "제가", "저희는", "저는", "우리가", "내가", "저희 쪽", "저희에서"],
  second: ["고객님", "본인이", "본인께서", "직접", "선생님께서", "당신"],
};

const EN: Lexicon = {
  prohibition: ["cannot", "can't", "can not", "may not", "must not", "mustn't", "not allowed", "not permitted", "prohibited", "forbidden", "not able to", "unable to", "please don't", "please do not", /(?:^|[.!?]\s+)(?:don't|do not)\b/i],
  obligation: ["must", "have to", "has to", "had to", "need to", "needs to", "required", "requires", "require", "obliged", "obligated", "mandatory", "necessary", "you'll need", "you will need", "you need"],
  permission: ["may", "can", "could", "allowed", "permitted", "able to", "it's okay to", "it is okay to", "it's fine to", "free to", "you can just"],
  hedge: ["maybe", "perhaps", "probably", "might", "may be", "i think", "not sure", "possibly", "likely", "may need", "i guess", "i believe", "seems"],
  conditional: ["if", "unless", "in case", "provided that", "when", "once", "as long as", "otherwise", "whenever"],
  pending: ["pending", "under review", "in progress", "not yet", "still processing", "being processed", "being reviewed", "processing", "reviewing", "waiting", "yet to", "still", "yet"],
  completed: ["completed", "complete", "already", "has been", "have been", "finished", "done", "was issued", "processed", "is ready"],
  directive: ["please", /(?:^|[.!?]\s+)(?:bring|submit|come|go|wait|fill|sign|show|take|pay|visit|apply|book|make|check|give|use|keep|print|write|call)\b/i],
  first: [/\b(?:i|we|i'll|we'll|i'm|we're|our|us)\b/i],
  second: [/\b(?:you|you'll|you're|your)\b/i],
};

const ZH_HANS: Lexicon = {
  prohibition: ["不能", "不可以", "不得", "禁止", "不允许", "不准", "不行", "不要", "不可"],
  obligation: ["必须", "需要", "应当", "应该", "务必", "得要", "要求"],
  permission: ["可以", "能够", "允许", /(?<![可不功智才本性])能(?![力源量])/],
  hedge: ["可能", "也许", "大概", "好像", "不确定", "似乎", "应该是"],
  conditional: ["如果", "要是", "的话", "假如", "若", "除非", "只要"],
  pending: ["审查中", "审核中", "处理中", "办理中", "还没", "尚未", "正在", "等待"],
  completed: ["已经", "已完成", "完成了", "办好了", "已办", "已受理", "已批准"],
  directive: ["请"],
  first: ["我们", "我"],
  second: ["你", "您"],
};

const ZH_HANT: Lexicon = {
  prohibition: ["不能", "不可以", "不得", "禁止", "不允許", "不准", "不行", "不要", "不可"],
  obligation: ["必須", "需要", "應當", "應該", "務必", "要求"],
  permission: ["可以", "能夠", "允許", /(?<![可不功智才本性])能(?![力源量])/],
  hedge: ["可能", "也許", "大概", "好像", "不確定", "似乎", "應該是"],
  conditional: ["如果", "要是", "的話", "假如", "若", "除非", "只要"],
  pending: ["審查中", "審核中", "處理中", "辦理中", "還沒", "尚未", "正在", "等待"],
  completed: ["已經", "已完成", "完成了", "辦好了", "已受理", "已核准"],
  directive: ["請"],
  first: ["我們", "我"],
  second: ["你", "您"],
};

const VI: Lexicon = {
  prohibition: ["không được", "không thể", "cấm", "không cho phép", "đừng"],
  obligation: ["phải", "bắt buộc", "cần phải", "cần", "yêu cầu"],
  permission: ["có thể", "được phép", "cho phép", "được không"],
  hedge: ["có lẽ", "có thể là", "chắc là", "hình như", "không chắc"],
  conditional: ["nếu", "trường hợp", "khi", "trừ khi", "miễn là"],
  pending: ["đang xử lý", "đang xét", "đang được xử lý", "đang chờ", "chưa", "đang được xem xét"],
  completed: ["đã xong", "hoàn thành", "đã hoàn tất", "đã được cấp"],
  directive: ["vui lòng", "xin hãy", "hãy", "xin vui lòng"],
  ignore: ["phải không", "đúng không"],
};

const ID: Lexicon = {
  prohibition: ["tidak boleh", "tidak bisa", "tidak dapat", "dilarang", "jangan", "tak boleh", "nggak bisa", "gak bisa"],
  obligation: ["harus", "wajib", "perlu", "mesti", "diharuskan"],
  permission: ["boleh", "dapat", "bisa", "diizinkan", "diperbolehkan"],
  hedge: ["mungkin", "sepertinya", "kayaknya", "tidak yakin", "barangkali", "kira-kira"],
  conditional: ["jika", "kalau", "apabila", "bila", "jikalau", "kecuali", "asalkan", "ketika"],
  pending: ["sedang diproses", "masih diproses", "belum", "sedang ditinjau", "menunggu"],
  completed: ["sudah selesai", "telah selesai", "sudah diterbitkan", "sudah jadi"],
  directive: ["silakan", "mohon", "tolong", "harap"],
  first: ["kami", "saya", "aku"],
  second: ["anda", "kamu", "bapak", "ibu"],
};

const RU: Lexicon = {
  prohibition: ["нельзя", "не может", "не можете", "не могу", "запрещ", "не разреш", "не допуска"],
  obligation: ["должн", "обязан", "необходимо", "нужно", "надо", "требуется", "обязательно"],
  permission: ["можно", "может", "можете", "могу", "разреш", "вправе"],
  hedge: ["может быть", "наверное", "возможно", "кажется", "не уверен", "вероятно"],
  conditional: ["если", "в случае", "при условии", "когда"],
  pending: ["рассматрива", "на рассмотрении", "ещё не", "еще не", "в процессе", "обрабатыва", "ожида"],
  completed: ["уже", "завершен", "готов", "выдан", "оформлен"],
  directive: ["пожалуйста", "прошу"],
  first: [/(?<![\p{L}])(?:я|мы)(?![\p{L}])/iu],
  second: [/(?<![\p{L}])(?:вы|вам|вас|ты|вами)(?![\p{L}])/iu],
};

const TH: Lexicon = {
  prohibition: ["ห้าม", "ไม่สามารถ", "ไม่อนุญาต", "ไม่ได้"],
  obligation: ["ต้อง", "จำเป็น"],
  permission: ["สามารถ", "อนุญาต", "ก็ได้"],
  hedge: ["อาจ", "คงจะ", "ไม่แน่ใจ", "น่าจะ", "มั้ง"],
  conditional: ["ถ้า", "หาก", "กรณี", "เมื่อ", "เว้นแต่"],
  pending: ["กำลังดำเนินการ", "อยู่ระหว่าง", "ยังไม่", "รอ"],
  completed: ["เสร็จแล้ว", "เรียบร้อยแล้ว", "ออกแล้ว"],
  directive: ["กรุณา", "โปรด"],
};

const LEXICONS: Partial<Record<RegistryLanguage, Lexicon>> = {
  ko: KO,
  en: EN,
  "zh-Hans": ZH_HANS,
  "zh-Hant": ZH_HANT,
  vi: VI,
  id: ID,
  ru: RU,
  th: TH,
};

/** Languages with a semantic lexicon. Mongolian and Uzbek have registry terms but no lexicon yet. */
export const SEMANTIC_LANGUAGES: readonly RegistryLanguage[] = Object.keys(LEXICONS) as RegistryLanguage[];

export function semanticCheckAvailable(language: string | undefined): boolean {
  const lang = registryLanguage(language);
  return !!lang && !!LEXICONS[lang];
}

/* -------------------------------------------------------------------------- */
/* Cue scanning                                                               */
/* -------------------------------------------------------------------------- */

const SPACED: ReadonlySet<RegistryLanguage> = new Set(["en", "vi", "id"]);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patternCache = new Map<string, RegExp>();

function toPattern(lang: RegistryLanguage, cue: Cue): RegExp {
  if (cue instanceof RegExp) {
    return new RegExp(cue.source, cue.flags.includes("g") ? cue.flags : `${cue.flags}g`);
  }
  const key = `${lang}\u0000${cue}`;
  const cached = patternCache.get(key);
  if (cached) return cached;
  const body = escape(cue).replace(/\s+/g, "\\s+");
  const pattern = SPACED.has(lang)
    ? new RegExp(`(?<![\\p{L}\\p{N}'’])${body}(?![\\p{L}\\p{N}])`, "giu")
    : lang === "ru"
      ? new RegExp(`(?<![\\p{L}])${body}`, "giu")
      : new RegExp(body, "giu");
  patternCache.set(key, pattern);
  return pattern;
}

interface Scan {
  /** The text with already-claimed spans blanked out. */
  masked: string;
  found: Partial<Record<CueSet, string>>;
}

function findIn(scan: Scan, lang: RegistryLanguage, set: CueSet, mask: boolean): void {
  for (const cue of LEXICONS[lang]?.[set] ?? []) {
    const pattern = toPattern(lang, cue);
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(scan.masked)) !== null) {
      if (!match[0].trim()) {
        pattern.lastIndex += 1;
        continue;
      }
      scan.found[set] ??= match[0].trim();
      if (mask) {
        scan.masked =
          scan.masked.slice(0, match.index) +
          " ".repeat(match[0].length) +
          scan.masked.slice(match.index + match[0].length);
      }
      if (!mask) break;
    }
  }
}

function scan(text: string, lang: RegistryLanguage): Scan {
  const result: Scan = { masked: ` ${text.normalize("NFKC")} `, found: {} };
  // Order matters: hedges and prohibitions contain permission words
  // ("may be", "can't", "不能", "không thể", "не может"), so they claim their
  // spans first and the permission scan sees only what is left.
  findIn(result, lang, "ignore", true);
  findIn(result, lang, "hedge", true);
  findIn(result, lang, "prohibition", true);
  for (const set of ["obligation", "permission", "conditional", "pending", "completed", "directive", "first", "second"] as const) {
    findIn(result, lang, set, false);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                 */
/* -------------------------------------------------------------------------- */

const SEVERITY_ORDER: Record<SemanticSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Concept categories where swapping one concept for another changes the legal consequence. */
const CRITICAL_CATEGORIES = new Set([
  "registration",
  "permission",
  "report",
  "procedure-stage",
  "deadline",
  "enforcement",
  "protection",
  "document",
]);

/** Concepts so consequential that inventing one is never a stylistic choice. */
const NEVER_INVENT = new Set([
  "approval",
  "rejection",
  "departure-order",
  "deportation",
  "refugee-recognition",
  "humanitarian-stay",
]);

function confusable(a: string, b: string): boolean {
  return (
    !!findConcept(a)?.confusableWith?.includes(b) || !!findConcept(b)?.confusableWith?.includes(a)
  );
}

export function checkSemanticIntegrity(
  sourceText: string,
  targetText: string,
  sourceLanguage: string | undefined,
  targetLanguage: string | undefined,
): SemanticIntegrity {
  const src = registryLanguage(sourceLanguage);
  const tgt = registryLanguage(targetLanguage);
  const all: SemanticCategory[] = [
    "modality",
    "procedure-concept",
    "conditional",
    "completion",
    "certainty",
    "actor",
    "invented-instruction",
  ];
  if (!src || !tgt || !LEXICONS[src] || !LEXICONS[tgt]) {
    return { status: "unsupported", checked: [], unchecked: all, issues: [] };
  }

  const s = scan(sourceText, src);
  const t = scan(targetText, tgt);
  const issues: SemanticIssue[] = [];
  const add = (issue: SemanticIssue) => issues.push(issue);

  /* --- Modality --------------------------------------------------------- */
  const sObl = s.found.obligation;
  const sPerm = s.found.permission;
  const sProh = s.found.prohibition;
  const tObl = t.found.obligation;
  const tPerm = t.found.permission;
  const tProh = t.found.prohibition;

  if (sObl && !tObl && tPerm && !tProh) {
    add({ category: "modality", check: "obligation-to-permission", severity: "critical", sourceEvidence: sObl, targetEvidence: tPerm, message: "원문은 의무(해야 함)인데 번역은 가능·허용으로 바뀌었습니다." });
  } else if (sObl && !tObl && !tProh && !t.found.directive) {
    add({ category: "modality", check: "obligation-dropped", severity: "medium", sourceEvidence: sObl, message: "원문의 의무 표현이 번역에서 보이지 않습니다." });
  }
  if (sPerm && !sObl && !sProh && tObl && !tPerm) {
    add({ category: "modality", check: "permission-to-obligation", severity: "critical", sourceEvidence: sPerm, targetEvidence: tObl, message: "원문은 가능·허용인데 번역은 의무로 바뀌었습니다." });
  }
  if (sProh && !tProh && tPerm) {
    add({ category: "modality", check: "prohibition-to-permission", severity: "critical", sourceEvidence: sProh, targetEvidence: tPerm, message: "원문은 금지·불가인데 번역은 가능으로 바뀌었습니다." });
  }
  if (sPerm && !sProh && tProh && !tPerm) {
    add({ category: "modality", check: "permission-to-prohibition", severity: "critical", sourceEvidence: sPerm, targetEvidence: tProh, message: "원문은 가능인데 번역은 금지·불가로 바뀌었습니다." });
  }

  /* --- Invented instruction --------------------------------------------- */
  if (tObl && !sObl && !sPerm && !sProh && !s.found.directive) {
    add({ category: "invented-instruction", check: "invented-requirement", severity: "medium", targetEvidence: tObl, message: "원문에 없는 의무·요구 표현이 번역에 들어갔습니다." });
  }

  /* --- Conditional ------------------------------------------------------ */
  if (s.found.conditional && !t.found.conditional) {
    add({ category: "conditional", check: "condition-dropped", severity: "high", sourceEvidence: s.found.conditional, message: "원문의 조건(~하면/~경우)이 번역에서 빠져 무조건적 진술이 되었을 수 있습니다." });
  } else if (!s.found.conditional && t.found.conditional) {
    add({ category: "conditional", check: "condition-added", severity: "low", targetEvidence: t.found.conditional, message: "원문에 없는 조건 표현이 번역에 있습니다." });
  }

  /* --- Completion ------------------------------------------------------- */
  if (s.found.pending && !t.found.pending && t.found.completed) {
    add({ category: "completion", check: "pending-to-completed", severity: "critical", sourceEvidence: s.found.pending, targetEvidence: t.found.completed, message: "원문은 진행·미완료인데 번역은 완료된 것으로 표현되었습니다." });
  } else if (s.found.completed && !s.found.pending && t.found.pending && !t.found.completed) {
    add({ category: "completion", check: "completed-to-pending", severity: "high", sourceEvidence: s.found.completed, targetEvidence: t.found.pending, message: "원문은 완료인데 번역은 진행 중으로 표현되었습니다." });
  } else if (s.found.pending && !t.found.pending) {
    add({ category: "completion", check: "pending-dropped", severity: "medium", sourceEvidence: s.found.pending, message: "원문의 '진행 중·아직' 표현이 번역에서 보이지 않습니다." });
  }

  /* --- Certainty -------------------------------------------------------- */
  if (s.found.hedge && !t.found.hedge) {
    add({ category: "certainty", check: "unjustified-certainty", severity: "high", sourceEvidence: s.found.hedge, message: "원문은 불확실(아마/~것 같다)한데 번역은 단정적입니다." });
  } else if (!s.found.hedge && t.found.hedge) {
    add({ category: "certainty", check: "added-uncertainty", severity: "medium", targetEvidence: t.found.hedge, message: "원문은 단정적인데 번역에 불확실 표현이 추가되었습니다." });
  }

  /* --- Actor ------------------------------------------------------------ */
  const actorChecked = !!(LEXICONS[src]?.first && LEXICONS[tgt]?.first);
  if (actorChecked) {
    const sFirst = !!s.found.first;
    const sSecond = !!s.found.second;
    const tFirst = !!t.found.first;
    const tSecond = !!t.found.second;
    if (sFirst && !sSecond && tSecond && !tFirst) {
      add({ category: "actor", check: "actor-changed", severity: "high", sourceEvidence: s.found.first, targetEvidence: t.found.second, message: "원문은 '저희/제가'가 하는 일인데 번역은 상대방이 하는 일로 바뀌었습니다." });
    } else if (sSecond && !sFirst && tFirst && !tSecond) {
      add({ category: "actor", check: "actor-changed", severity: "high", sourceEvidence: s.found.second, targetEvidence: t.found.first, message: "원문은 상대방이 하는 일인데 번역은 '저희/제가'가 하는 일로 바뀌었습니다." });
    }
  }

  /* --- Procedure concepts ----------------------------------------------- */
  const sMatches = matchConcepts(sourceText, sourceLanguage);
  const tMatches = matchConcepts(targetText, targetLanguage);
  const sIds = new Set(sMatches.map((match) => match.conceptId));
  const tIds = new Set(tMatches.map((match) => match.conceptId));

  for (const id of sIds) {
    if (tIds.has(id)) continue;
    const swap = [...tIds].find((other) => !sIds.has(other) && confusable(id, other));
    if (!swap) continue;
    const from = findConcept(id)!;
    const to = findConcept(swap)!;
    add({
      category: "procedure-concept",
      check: "concept-substituted",
      severity: CRITICAL_CATEGORIES.has(from.category) ? "critical" : "high",
      sourceEvidence: sMatches.find((match) => match.conceptId === id)?.text,
      targetEvidence: tMatches.find((match) => match.conceptId === swap)?.text,
      message: `원문은 '${from.ko}'인데 번역은 '${to.ko}'(으)로 읽힙니다.`,
    });
  }

  for (const match of tMatches) {
    // A mistranslation-prone word only matters when the source is talking
    // about that procedure: "card payment is accepted" is not an approval.
    const relevant =
      sIds.has(match.conceptId) || [...sIds].some((id) => confusable(id, match.conceptId));
    if (match.kind === "mt-error" && relevant) {
      const concept = findConcept(match.conceptId)!;
      add({
        category: "procedure-concept",
        check: "mistranslation-prone-term",
        severity: concept.category === "procedure-stage" ? "high" : "medium",
        targetEvidence: match.text,
        message: `번역의 '${match.text}'는 '${concept.ko}'의 흔한 오역 표현입니다.`,
      });
    }
  }

  for (const id of tIds) {
    if (sIds.has(id) || !NEVER_INVENT.has(id)) continue;
    // Overlap resolution can hide a mention inside a longer one ("인도적 체류
    // 허가를 받" is humanitarian-stay, but it also says a permission was
    // granted). Before calling a concept invented, look for it anywhere.
    if (conceptMentionedAnywhere(sourceText, sourceLanguage, id)) continue;
    if ([...sIds].some((other) => confusable(id, other))) continue; // already reported as a swap
    add({
      category: "invented-instruction",
      check: "invented-concept",
      severity: "high",
      targetEvidence: tMatches.find((match) => match.conceptId === id)?.text,
      message: `원문에 없는 '${findConcept(id)!.ko}'이(가) 번역에 등장합니다.`,
    });
  }

  const unchecked: SemanticCategory[] = actorChecked ? [] : ["actor"];
  const checked = all.filter((category) => !unchecked.includes(category));
  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { status: unchecked.length ? "partial" : "checked", checked, unchecked, issues };
}

export const highestSeverity = (issues: readonly SemanticIssue[]): SemanticSeverity | null =>
  issues.reduce<SemanticSeverity | null>(
    (worst, issue) =>
      worst === null || SEVERITY_ORDER[issue.severity] < SEVERITY_ORDER[worst] ? issue.severity : worst,
    null,
  );
