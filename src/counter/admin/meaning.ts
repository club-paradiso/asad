/**
 * Administrative Meaning Layer.
 *
 * Reads an utterance, finds the administrative concepts in it, and reports
 * where more than one procedure fits what was said. It NEVER picks one: it
 * lists candidates and suggests a neutral question the staff member may choose
 * to ask in their own voice. The translation itself is not touched.
 *
 * Every rule is data below and is exercised by `meaning.test.ts` and the
 * administrative benchmark. A rule that fires on a faithful, unambiguous
 * utterance is a false positive and is counted as one.
 */
import { findConcept, registryLanguage } from "./registry";
import { matchConcepts } from "./matcher";
import type {
  AdministrativeAnalysis,
  AmbiguityFinding,
  AmbiguityKind,
  ClarificationSuggestion,
  MatchKind,
  RegistryLanguage,
  TermAnnotation,
  TermMatch,
  UncertaintyBreakdown,
} from "./types";

type Cues = Partial<Record<RegistryLanguage, readonly string[]>>;

interface AmbiguityRule {
  id: string;
  kind: AmbiguityKind;
  /** At least one of these concepts must be mentioned (optionally only via these kinds). */
  concepts?: { ids: readonly string[]; kinds?: readonly MatchKind[] };
  /** At least one cue from each group must appear in the utterance. */
  cueGroups?: readonly Cues[];
  /** A concept that must appear in the utterance OR the recent turns. */
  context?: readonly string[];
  /** Concepts whose explicit (term/alternative) mention already resolves the ambiguity. */
  resolvedBy?: readonly string[];
  /** Concepts whose explicit mention means the procedure stage is already stated. */
  candidates: readonly string[];
  explanation: string;
  question: { ko: string; en: string };
}

const EXTENSION_CUES: Cues = {
  ko: ["연장"],
  en: ["extend", "extension", "renew", "renewal"],
  "zh-Hans": ["延期", "延长", "续"],
  "zh-Hant": ["延期", "延長", "續"],
  vi: ["gia hạn"],
  id: ["perpanjang"],
  ru: ["продл"],
  th: ["ต่อ", "ขยาย"],
  mn: ["сунга"],
  uz: ["uzaytir"],
};

const DONE_CUES: Cues = {
  ko: ["다 됐", "다 했", "끝났", "처리됐", "처리 됐", "했어요", "했습니다", "했는데"],
  en: ["done", "finished", "already did", "did it", "took care of", "sorted", "i did"],
  "zh-Hans": ["办好了", "办完了", "弄好了", "办了"],
  "zh-Hant": ["辦好了", "辦完了", "辦了"],
  vi: ["xong rồi", "làm rồi", "làm xong"],
  id: ["sudah selesai", "sudah beres", "sudah urus"],
  ru: ["сделал", "сделала", "оформил", "оформила", "готово"],
  th: ["เสร็จแล้ว", "ทำแล้ว"],
  mn: ["хийчихсэн", "дууссан"],
  uz: ["qildim", "tugadi"],
};

const INFORMED_CUES: Cues = {
  ko: ["말했", "알렸", "얘기했", "이야기했"],
  en: ["told immigration", "informed immigration", "let immigration know", "told them", "told you", "informed"],
  "zh-Hans": ["告诉过", "说过了", "通知了", "告诉了"],
  "zh-Hant": ["告訴過", "說過了", "通知了"],
  vi: ["đã báo", "báo rồi"],
  id: ["sudah kasih tahu", "sudah memberitahu"],
  ru: ["сообщил", "сообщила"],
  th: ["บอกแล้ว", "แจ้งแล้ว"],
};

const DEADLINE_CUES: Cues = {
  ko: ["기한", "언제까지", "마감"],
  en: ["deadline", "until when", "by when", "how long can i stay", "how long do i have"],
  "zh-Hans": ["期限", "到什么时候", "截止"],
  "zh-Hant": ["期限", "到什麼時候", "截止"],
  vi: ["hạn chót", "đến khi nào", "đến bao giờ"],
  id: ["batas waktu", "sampai kapan"],
  ru: ["срок", "до какого", "до когда"],
  th: ["กำหนด", "ถึงเมื่อไร"],
  mn: ["хугацаа", "хэзээ хүртэл"],
  uz: ["muddat", "qachongacha"],
};

const LEAVE_CUES: Cues = {
  ko: ["출국", "나가야", "떠나"],
  en: ["leave", "depart"],
  "zh-Hans": ["出境", "离开", "回国", "离境"],
  "zh-Hant": ["出境", "離開", "回國", "離境"],
  vi: ["xuất cảnh", "rời"],
  id: ["keluar", "pulang", "meninggalkan"],
  ru: ["выезд", "уехать", "выехать", "покинуть"],
  th: ["ออกนอกประเทศ", "กลับประเทศ"],
  mn: ["гарах", "буцах"],
  uz: ["chiqib ketish", "ketish"],
};

const REFUGEE_CUES: Cues = {
  ko: ["난민"],
  en: ["refugee", "asylum"],
  "zh-Hans": ["难民", "庇护"],
  "zh-Hant": ["難民", "庇護"],
  vi: ["tị nạn"],
  id: ["pengungsi", "suaka"],
  ru: ["беженц", "убежищ"],
  th: ["ผู้ลี้ภัย", "ลี้ภัย"],
  mn: ["дүрвэгч"],
  uz: ["qochqin", "boshpana"],
};

const OUTCOME_CUES: Cues = {
  ko: ["받았", "나왔", "인정됐", "됐어요", "됐습니다", "허가"],
  en: ["got", "granted", "approved", "received", "have status", "came through"],
  "zh-Hans": ["批了", "下来了", "拿到", "获得", "通过了"],
  "zh-Hant": ["批了", "下來了", "拿到", "獲得", "通過了"],
  vi: ["được rồi", "đã được", "nhận được"],
  id: ["sudah dapat", "dapat", "diterima"],
  ru: ["получил", "получила", "дали"],
  th: ["ได้แล้ว", "ได้รับ"],
  mn: ["авсан"],
  uz: ["oldim", "berildi"],
};

const TRANSFER_CUES: Cues = {
  ko: ["전근", "발령", "근무지 이동", "근무지가 바뀌"],
  en: ["transferred", "relocated", "got moved to"],
  "zh-Hans": ["调动", "调到"],
  "zh-Hant": ["調動", "調到"],
  vi: ["chuyển công tác"],
  id: ["dipindahtugaskan", "mutasi"],
  ru: ["перевели"],
  th: ["ย้ายไปทำงาน"],
};

const VISA_CARD_CUES: Cues = {
  ko: ["비자 카드", "비자카드"],
  en: ["visa card"],
  "zh-Hans": ["签证卡"],
  "zh-Hant": ["簽證卡"],
  vi: ["thẻ visa"],
  id: ["kartu visa"],
  ru: ["визовая карта", "визовую карту"],
  th: ["บัตรวีซ่า"],
};

/** Procedures whose stage ("I did it") can be unclear. */
const PROCEDURES = [
  "stay-extension",
  "status-change",
  "activity-permission",
  "workplace-change",
  "residence-change",
  "reentry-permit",
  "card-reissuance",
  "refugee-application",
  "foreigner-registration",
];

export const AMBIGUITY_RULES: readonly AmbiguityRule[] = [
  {
    id: "card-or-stay-extension",
    kind: "procedural",
    concepts: { ids: ["residence-card"] },
    cueGroups: [EXTENSION_CUES],
    resolvedBy: ["stay-extension", "card-reissuance"],
    candidates: ["stay-extension", "card-reissuance"],
    explanation:
      "등록증(카드)과 '연장'이 함께 나왔습니다. 체류기간 연장허가인지, 카드 재발급·교체인지 발화만으로 알 수 없습니다.",
    question: {
      ko: "체류기간을 연장하려고 오신 건가요, 아니면 외국인등록증 카드를 새로 받으려고 오신 건가요?",
      en: "Are you here to extend your period of stay, or to get a new residence card?",
    },
  },
  {
    id: "visa-extension-wording",
    kind: "terminology",
    concepts: { ids: ["stay-extension"], kinds: ["colloquial"] },
    resolvedBy: [],
    candidates: ["stay-extension", "visa"],
    explanation:
      "'비자 연장'류 표현입니다. 사증 자체는 연장 대상이 아니어서 보통 체류기간 연장허가를 뜻하지만, 다른 절차일 수 있습니다.",
    question: {
      ko: "지금 체류기간을 늘리려는 것인지, 다른 절차를 말씀하시는 것인지 알려 주시겠어요?",
      en: "Do you want to extend your current period of stay, or do you mean a different procedure?",
    },
  },
  {
    id: "job-change-scope",
    kind: "procedural",
    concepts: { ids: ["workplace-change"], kinds: ["colloquial"] },
    resolvedBy: ["status-change"],
    candidates: ["workplace-change", "status-change"],
    explanation:
      "직장이 바뀌었다는 말만으로는 근무처 변경·추가인지 체류자격 변경이 필요한 상황인지 알 수 없습니다. 근무처 변경은 체류자격에 따라 사전 허가 또는 신고 대상입니다(출입국관리법 제21조).",
    question: {
      ko: "새 직장에서 하시는 일이 이전과 같은 종류의 일인가요?",
      en: "Is the work at your new job the same kind of work as before?",
    },
  },
  {
    id: "address-or-workplace",
    kind: "procedural",
    cueGroups: [TRANSFER_CUES],
    resolvedBy: ["residence-change"],
    candidates: ["residence-change", "workplace-change"],
    explanation: "전근·이동 표현입니다. 사는 곳이 바뀐 것인지, 일하는 곳이 바뀐 것인지, 둘 다인지 알 수 없습니다.",
    question: {
      ko: "사시는 곳(주소)이 바뀌신 건가요, 일하는 곳이 바뀌신 건가요, 아니면 둘 다인가요?",
      en: "Did your home address change, your workplace, or both?",
    },
  },
  {
    id: "permission-or-report",
    kind: "procedural",
    concepts: { ids: ["workplace-change"] },
    cueGroups: [INFORMED_CUES],
    resolvedBy: ["approval"],
    candidates: ["reporting", "approval"],
    explanation:
      "근무처 변경을 '알렸다'는 표현입니다. 근무처 변경은 원칙적으로 사전 허가이고 일부만 신고 대상이라(제21조), 어떤 절차를 거쳤는지 확인이 필요합니다.",
    question: {
      ko: "그때 허가를 받으신 건가요, 신고만 하신 건가요? 받으신 서류가 있으면 보여 주시겠어요?",
      en: "At that time, did you receive a permission, or did you only file a report? If you have any document from it, could you show me?",
    },
  },
  {
    id: "permission-or-report-explicit",
    kind: "procedural",
    concepts: { ids: ["reporting"] },
    context: ["workplace-change"],
    resolvedBy: ["approval"],
    candidates: ["reporting", "approval"],
    explanation:
      "근무처 변경과 '신고'가 함께 나왔습니다. 근무처 변경은 원칙적으로 사전 허가 대상이고 일부만 신고 대상이므로(제21조) 실제로 어떤 절차였는지 확인이 필요합니다.",
    question: {
      ko: "그때 허가를 받으신 건가요, 신고만 하신 건가요? 받으신 서류가 있으면 보여 주시겠어요?",
      en: "At that time, did you receive a permission, or did you only file a report? If you have any document from it, could you show me?",
    },
  },
  {
    id: "stage-unclear",
    kind: "procedural",
    cueGroups: [DONE_CUES],
    context: PROCEDURES,
    resolvedBy: ["application", "acceptance", "approval", "rejection", "reporting"],
    candidates: ["application", "acceptance", "approval"],
    explanation:
      "'했다/됐다'는 표현만으로는 신청서를 낸 것인지, 접수된 것인지, 허가 결과까지 받은 것인지 알 수 없습니다.",
    question: {
      ko: "신청서를 내신 단계인가요, 아니면 허가 결과까지 받으셨나요?",
      en: "Have you only submitted the application, or have you already received the decision?",
    },
  },
  {
    id: "deadline-type",
    kind: "procedural",
    cueGroups: [DEADLINE_CUES, LEAVE_CUES],
    resolvedBy: ["departure-deadline", "stay-expiry", "departure-order"],
    candidates: ["departure-deadline", "stay-expiry"],
    explanation:
      "출국과 기한이 함께 나왔습니다. 출국명령 등에 정해진 출국기한인지, 원래 체류기간 만료일인지 알 수 없습니다.",
    question: {
      ko: "서류에 적힌 출국기한을 말씀하시는 건가요, 아니면 원래 체류기간이 끝나는 날을 말씀하시는 건가요?",
      en: "Do you mean the departure deadline written on a document, or the date your period of stay ends?",
    },
  },
  {
    id: "refugee-outcome",
    kind: "procedural",
    cueGroups: [REFUGEE_CUES, OUTCOME_CUES],
    resolvedBy: ["refugee-recognition", "humanitarian-stay"],
    candidates: ["refugee-recognition", "humanitarian-stay", "refugee-application"],
    explanation:
      "난민 관련 결과를 받았다는 표현입니다. 난민인정인지, 인도적 체류 허가인지, 신청 접수인지 발화만으로 알 수 없습니다(난민법 제2조).",
    question: {
      ko: "어떤 결정을 받으셨는지 정확히 확인하려고 합니다. 받으신 결정 통지서를 보여 주시겠어요?",
      en: "I want to be sure which decision you received. Could you show me the decision notice you were given?",
    },
  },
  {
    id: "visa-means-card",
    kind: "terminology",
    cueGroups: [VISA_CARD_CUES],
    resolvedBy: [],
    candidates: ["residence-card", "visa", "residence-status"],
    explanation: "'비자 카드' 표현입니다. 외국인등록증(카드), 여권의 사증, 체류자격 중 무엇인지 알 수 없습니다.",
    question: {
      ko: "말씀하신 것이 외국인등록증 카드인가요, 여권에 있는 비자인가요?",
      en: "Do you mean your residence card, or the visa in your passport?",
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Cue matching                                                               */
/* -------------------------------------------------------------------------- */

const SPACED: ReadonlySet<RegistryLanguage> = new Set(["en", "vi", "id"]);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cueCache = new Map<string, RegExp>();

function cuePattern(lang: RegistryLanguage, cue: string): RegExp {
  const key = `${lang}\u0000${cue}`;
  let pattern = cueCache.get(key);
  if (!pattern) {
    const body = escape(cue.normalize("NFKC")).replace(/\s+/g, "\\s*");
    pattern = SPACED.has(lang)
      ? new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu")
      : lang === "ru" || lang === "mn" || lang === "uz"
        ? new RegExp(`(?<![\\p{L}\\p{N}])${body}`, "iu")
        : new RegExp(body, "iu");
    cueCache.set(key, pattern);
  }
  return pattern;
}

function findCue(text: string, langs: readonly RegistryLanguage[], cues: Cues): string | null {
  for (const lang of langs) {
    for (const cue of cues[lang] ?? []) {
      const match = cuePattern(lang, cue).exec(text);
      if (match) return match[0];
    }
  }
  return null;
}

const EXPLICIT: ReadonlySet<MatchKind> = new Set(["term", "alternative"]);

/* -------------------------------------------------------------------------- */
/* Analysis                                                                   */
/* -------------------------------------------------------------------------- */

export interface AmbiguityInput {
  text: string;
  lang: string;
  recent?: readonly { text: string; lang?: string }[];
}

export function detectAmbiguities(input: AmbiguityInput): AmbiguityFinding[] {
  const text = input.text.normalize("NFKC");
  const primary = registryLanguage(input.lang);
  const langs: RegistryLanguage[] = [...new Set([primary, "en", "ko"].filter(Boolean))] as RegistryLanguage[];
  const matches = matchConcepts(text, input.lang);
  const recentConcepts = new Set(
    (input.recent ?? []).flatMap((turn) =>
      matchConcepts(turn.text, turn.lang ?? input.lang).map((match) => match.conceptId),
    ),
  );
  const mentioned = new Set(matches.map((match) => match.conceptId));

  const findings: AmbiguityFinding[] = [];
  for (const rule of AMBIGUITY_RULES) {
    const evidence: string[] = [];

    if (rule.concepts) {
      const hits = matches.filter(
        (match) =>
          rule.concepts!.ids.includes(match.conceptId) &&
          (!rule.concepts!.kinds || rule.concepts!.kinds.includes(match.kind)),
      );
      if (!hits.length) continue;
      evidence.push(...hits.map((hit) => hit.text));
    }

    let cuesOk = true;
    for (const group of rule.cueGroups ?? []) {
      const cue = findCue(text, langs, group);
      if (!cue) {
        cuesOk = false;
        break;
      }
      evidence.push(cue);
    }
    if (!cuesOk) continue;

    if (rule.context && !rule.context.some((id) => mentioned.has(id) || recentConcepts.has(id))) {
      continue;
    }

    const resolved = matches.some(
      (match) => rule.resolvedBy?.includes(match.conceptId) && EXPLICIT.has(match.kind),
    );
    if (resolved) continue;

    findings.push({
      ruleId: rule.id,
      kind: rule.kind,
      evidence: [...new Set(evidence)],
      candidates: rule.candidates.map((id) => {
        const concept = findConcept(id)!;
        return { conceptId: id, ko: concept.ko, en: concept.terms.en?.term ?? id };
      }),
      explanation: rule.explanation,
    });
  }

  // Two rules for the same question are one finding to a human.
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = finding.candidates.map((candidate) => candidate.conceptId).sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const DEFAULT_VARIANT_NOTE: Record<Exclude<MatchKind, "term" | "alternative">, string> = {
  colloquial: "구어 표현 — 공식 절차명으로 단정하지 말 것",
  "asr-error": "음성인식 오류로 보이는 표기 — 원문 확인 필요",
  "mt-error": "기계번역에서 흔한 오역 표현",
};

function annotate(match: TermMatch, otherLang: string | undefined): TermAnnotation {
  const concept = findConcept(match.conceptId)!;
  const en = concept.terms.en!;
  const other = registryLanguage(otherLang);
  const target = other ? concept.terms[other] : undefined;
  const variant = concept.variants.find(
    (candidate) => candidate.text.toLowerCase() === match.text.toLowerCase(),
  );
  const note =
    match.kind === "term" || match.kind === "alternative"
      ? variant?.note
      : (variant?.note ?? DEFAULT_VARIANT_NOTE[match.kind]);
  return {
    conceptId: concept.id,
    heard: match.text,
    kind: match.kind,
    ko: concept.ko,
    en: en.term,
    enStatus: en.status,
    ...(target && otherLang ? { target: { lang: otherLang, term: target.term, status: target.status } } : {}),
    ...(note ? { note } : {}),
  };
}

export interface AnalysisInput extends AmbiguityInput {
  /** The other party's language: which rendering to show beside the term. */
  otherLang?: string;
  inputMode?: "voice" | "text";
  /** Model-reported confidence, when a translation exists. */
  modelConfidence?: "high" | "medium" | "low";
  /** Outcome of the automatic checks, when a translation exists. */
  checks?: "passed" | "review" | "blocked" | "unverified";
  /**
   * Whether to look for procedural ambiguity. Off for staff turns: the staff
   * member states the procedure, and flagging their own guidance as
   * "ambiguous" is noise. Defaults to true.
   */
  detectAmbiguity?: boolean;
}

export function analyzeUtterance(input: AnalysisInput): AdministrativeAnalysis {
  const matches = matchConcepts(input.text, input.lang);
  const seen = new Set<string>();
  const terms = matches
    .map((match) => annotate(match, input.otherLang))
    .filter((term) => {
      const key = `${term.conceptId}\u0000${term.heard.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);

  const ambiguities = input.detectAmbiguity === false ? [] : detectAmbiguities(input);
  const clarifications: ClarificationSuggestion[] = ambiguities.map((finding) => {
    const rule = AMBIGUITY_RULES.find((candidate) => candidate.id === finding.ruleId)!;
    return { ruleId: rule.id, ko: rule.question.ko, en: rule.question.en };
  });

  return {
    version: 1,
    terms,
    ambiguities,
    clarifications,
    uncertainty: uncertaintyFor(input, terms, ambiguities),
  };
}

function uncertaintyFor(
  input: AnalysisInput,
  terms: TermAnnotation[],
  ambiguities: AmbiguityFinding[],
): UncertaintyBreakdown {
  const risky = terms.filter((term) => term.kind !== "term" && term.kind !== "alternative");
  const provisional = terms.filter((term) => term.target?.status === "provisional");
  const terminology =
    risky.length > 0
      ? { level: "present" as const, reason: `비공식·오인식 표현 ${risky.map((term) => `'${term.heard}'`).join(", ")}` }
      : provisional.length > 0
        ? { level: "present" as const, reason: "상대 언어 번역어가 임시(미검증) 용어임" }
        : terms.length > 0
          ? { level: "none-detected" as const, reason: "등록된 행정 용어로 표현됨" }
          : { level: "none-detected" as const, reason: "행정 용어 미검출" };

  const translation = (() => {
    if (!input.modelConfidence) {
      return { level: "unmeasured" as const, reason: "번역 결과 없음" };
    }
    if (input.checks === "blocked") return { level: "present" as const, reason: "자동 검사에서 의미·값 불일치" };
    if (input.checks === "review") return { level: "present" as const, reason: "자동 검사에서 확인 권장 항목" };
    if (input.modelConfidence !== "high") {
      return { level: "present" as const, reason: `모델 자체 평가 ${input.modelConfidence}` };
    }
    if (input.checks === "unverified") {
      return { level: "unmeasured" as const, reason: "이 언어 조합은 의미 검사 미지원 — 값 검사만 수행" };
    }
    return { level: "none-detected" as const, reason: "모델 자체 평가 high, 자동 검사 통과(사람 검토 아님)" };
  })();

  return {
    acoustic:
      input.inputMode === "voice"
        ? { level: "unmeasured", reason: "음성인식 신뢰도는 서버에 전달되지 않음 — 원문을 확인하세요" }
        : { level: "not-applicable", reason: "입력된 텍스트" },
    terminology,
    procedural:
      ambiguities.length > 0
        ? { level: "present", reason: `절차 후보 ${ambiguities.length}건 — 확인 질문 필요` }
        : { level: "none-detected", reason: "등록된 모호성 규칙에 해당 없음" },
    translation,
  };
}

/** Desks whose conversations are administrative enough to analyse. */
const ADMIN_PROFILES = new Set(["general", "immigration", "refugee", "judicial", "public-office"]);

/**
 * Whether the layer runs for this profile. `COUNTER_ADMIN_LAYER=off` disables
 * it everywhere without a deploy of new code.
 */
export function adminLayerEnabled(profileId: string | undefined): boolean {
  if (process.env.COUNTER_ADMIN_LAYER?.trim().toLowerCase() === "off") return false;
  return ADMIN_PROFILES.has(profileId ?? "general");
}
