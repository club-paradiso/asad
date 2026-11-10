/**
 * Synthetic administrative-meaning benchmark.
 *
 * Every line was written for this file; none comes from a real applicant,
 * case or transcript, and no line contains a real person's identifying data.
 *
 * Three independent sets, each scored separately (see admin-quality.ts):
 *
 *   1. TERMINOLOGY — does the matcher map what was said to the right concept,
 *      and recognise colloquial / misheard / mistranslated wording as such?
 *   2. AMBIGUITY   — does the meaning layer flag utterances where more than one
 *      procedure fits, and stay quiet when the procedure is stated?
 *   3. SEMANTIC    — does the semantic validator accept faithful renderings and
 *      catch meaning-changing ones?
 *
 * Provenance note, kept honest: these sets were written AFTER the rules and
 * lexicons, by the same author, in the same session. They are a held-out set
 * in the narrow sense that no rule was tuned on them before the first run —
 * the first-run result is recorded in docs/counter-admin/benchmark.md — but
 * they are NOT independent of the author's assumptions. Independent bilingual
 * review is still required (docs/counter-admin/human-review.md).
 *
 * Non-Korean, non-English lines are the author's own writing and have not
 * been checked by a native speaker.
 */

export interface TerminologyCase {
  id: string;
  lang: string;
  text: string;
  /** Expected concept mentions; order-insensitive. Empty = no concept. */
  expect: Array<{ conceptId: string; kind: "term" | "alternative" | "colloquial" | "asr-error" | "mt-error" }>;
}

export interface AmbiguityCase {
  id: string;
  lang: string;
  text: string;
  recent?: Array<{ text: string; lang?: string }>;
  /** Expected rule ids. Empty = the utterance is unambiguous. */
  expect: string[];
}

export interface SemanticCase {
  id: string;
  sourceLang: string;
  targetLang: string;
  source: string;
  faithful: string[];
  corrupted: Array<{ text: string; check: string; severity: "critical" | "high" }>;
}

/* -------------------------------------------------------------------------- */
/* 1. Terminology                                                             */
/* -------------------------------------------------------------------------- */

export const TERMINOLOGY_CASES: TerminologyCase[] = [
  { id: "t-ko-1", lang: "ko-KR", text: "체류자격 변경허가 받으러 왔습니다.", expect: [{ conceptId: "status-change", kind: "term" }] },
  { id: "t-ko-2", lang: "ko-KR", text: "비자 연장하려고요.", expect: [{ conceptId: "stay-extension", kind: "colloquial" }] },
  { id: "t-ko-3", lang: "ko-KR", text: "카드 잃어버렸어요.", expect: [{ conceptId: "card-reissuance", kind: "colloquial" }] },
  { id: "t-ko-4", lang: "ko-KR", text: "다음 달에 이사해요.", expect: [{ conceptId: "residence-change", kind: "colloquial" }] },
  { id: "t-ko-5", lang: "ko-KR", text: "재입국허가 필요한가요?", expect: [{ conceptId: "reentry-permit", kind: "term" }] },
  { id: "t-ko-6", lang: "ko-KR", text: "체류기관 연장 신청", expect: [{ conceptId: "stay-extension", kind: "asr-error" }, { conceptId: "application", kind: "term" }] },
  { id: "t-ko-7", lang: "ko-KR", text: "잠시만 기다려 주세요.", expect: [] },
  { id: "t-ko-8", lang: "ko-KR", text: "인도적 체류자이신가요?", expect: [{ conceptId: "humanitarian-stay", kind: "term" }] },
  { id: "t-en-1", lang: "en-US", text: "I lost my ARC yesterday.", expect: [{ conceptId: "residence-card", kind: "alternative" }] },
  { id: "t-en-2", lang: "en-US", text: "Can I extend my stay?", expect: [{ conceptId: "stay-extension", kind: "term" }] },
  { id: "t-en-3", lang: "en-US", text: "I changed jobs last week.", expect: [{ conceptId: "workplace-change", kind: "colloquial" }] },
  // Corrected after the first run: "application" is itself a mention of the application concept.
  { id: "t-en-4", lang: "en-US", text: "My application was accepted.", expect: [{ conceptId: "application", kind: "term" }, { conceptId: "acceptance", kind: "mt-error" }] },
  { id: "t-en-5", lang: "en-US", text: "Where is the bathroom?", expect: [] },
  { id: "t-en-6", lang: "en-US", text: "I received a departure order.", expect: [{ conceptId: "departure-order", kind: "term" }] },
  { id: "t-zh-1", lang: "zh-CN", text: "我的登录证丢了。", expect: [{ conceptId: "residence-card", kind: "colloquial" }] },
  { id: "t-zh-2", lang: "zh-CN", text: "我想续签。", expect: [{ conceptId: "stay-extension", kind: "colloquial" }] },
  { id: "t-zh-3", lang: "zh-CN", text: "我换工作了。", expect: [{ conceptId: "workplace-change", kind: "colloquial" }] },
  { id: "t-zh-4", lang: "zh-CN", text: "我上个月搬家了。", expect: [{ conceptId: "residence-change", kind: "colloquial" }] },
  { id: "t-zh-5", lang: "zh-CN", text: "需要预约吗？", expect: [{ conceptId: "appointment", kind: "term" }] },
  { id: "t-zh-6", lang: "zh-CN", text: "今天天气很好。", expect: [] },
  { id: "t-tw-1", lang: "zh-TW", text: "我的居留證過期了嗎？", expect: [{ conceptId: "residence-card", kind: "colloquial" }] },
  { id: "t-tw-2", lang: "zh-TW", text: "我想申請難民。", expect: [{ conceptId: "refugee-application", kind: "term" }] },
  { id: "t-vi-1", lang: "vi-VN", text: "Tôi muốn gia hạn visa.", expect: [{ conceptId: "stay-extension", kind: "colloquial" }] },
  { id: "t-vi-2", lang: "vi-VN", text: "Tôi bị mất thẻ.", expect: [{ conceptId: "card-reissuance", kind: "colloquial" }] },
  { id: "t-vi-3", lang: "vi-VN", text: "Lệ phí là bao nhiêu?", expect: [{ conceptId: "fee", kind: "term" }] },
  { id: "t-id-1", lang: "id-ID", text: "Saya mau perpanjang visa.", expect: [{ conceptId: "stay-extension", kind: "colloquial" }] },
  { id: "t-id-2", lang: "id-ID", text: "Saya pindah kerja bulan lalu.", expect: [{ conceptId: "workplace-change", kind: "colloquial" }] },
  { id: "t-id-3", lang: "id-ID", text: "Kartu ARC saya hilang.", expect: [{ conceptId: "card-reissuance", kind: "colloquial" }] },
  { id: "t-ru-1", lang: "ru-RU", text: "Я хочу продлить визу.", expect: [{ conceptId: "stay-extension", kind: "colloquial" }] },
  { id: "t-ru-2", lang: "ru-RU", text: "Я переехал в другой город.", expect: [{ conceptId: "residence-change", kind: "colloquial" }] },
  { id: "t-ru-3", lang: "ru-RU", text: "Мне грозит депортация?", expect: [{ conceptId: "deportation", kind: "term" }] },
  { id: "t-th-1", lang: "th-TH", text: "ฉันอยากต่อวีซ่า", expect: [{ conceptId: "stay-extension", kind: "colloquial" }] },
  { id: "t-th-2", lang: "th-TH", text: "ฉันเปลี่ยนงานแล้ว", expect: [{ conceptId: "workplace-change", kind: "colloquial" }] },
  { id: "t-mn-1", lang: "mn-MN", text: "Би визээ сунгах гэсэн юм.", expect: [{ conceptId: "stay-extension", kind: "colloquial" }] },
  { id: "t-mn-2", lang: "mn-MN", text: "Цаг захиалга хэрэгтэй юу?", expect: [{ conceptId: "appointment", kind: "term" }] },
  { id: "t-uz-1", lang: "uz-UZ", text: "Men vizani uzaytirish uchun keldim.", expect: [{ conceptId: "stay-extension", kind: "colloquial" }] },
  { id: "t-uz-2", lang: "uz-UZ", text: "Qayta kirish ruxsatnomasi kerakmi?", expect: [{ conceptId: "reentry-permit", kind: "term" }] },
  { id: "t-mix-1", lang: "vi-VN", text: "Em cần làm lại 외국인등록증 ạ.", expect: [{ conceptId: "card-reissuance", kind: "colloquial" }] },
];

/* -------------------------------------------------------------------------- */
/* 2. Ambiguity                                                               */
/* -------------------------------------------------------------------------- */

export const AMBIGUITY_CASES: AmbiguityCase[] = [
  // Ambiguous — should be flagged.
  { id: "a-zh-1", lang: "zh-CN", text: "我想延期登录证。", expect: ["card-or-stay-extension"] },
  { id: "a-ko-1", lang: "ko-KR", text: "등록증 연장하러 왔어요.", expect: ["card-or-stay-extension"] },
  { id: "a-en-1", lang: "en-US", text: "I need to renew my ARC.", expect: ["card-or-stay-extension"] },
  { id: "a-vi-1", lang: "vi-VN", text: "Tôi muốn gia hạn thẻ cư trú.", expect: ["card-or-stay-extension"] },
  { id: "a-ru-1", lang: "ru-RU", text: "Нужно продлить вид на жительство.", expect: ["card-or-stay-extension"] },
  { id: "a-en-2", lang: "en-US", text: "I want to extend my visa.", expect: ["visa-extension-wording"] },
  { id: "a-id-1", lang: "id-ID", text: "Saya mau perpanjangan visa.", expect: ["visa-extension-wording"] },
  { id: "a-ko-2", lang: "ko-KR", text: "직장 바꿨는데 뭐 해야 돼요?", expect: ["job-change-scope"] },
  { id: "a-zh-2", lang: "zh-CN", text: "我跳槽了，要办什么？", expect: ["job-change-scope"] },
  { id: "a-en-3", lang: "en-US", text: "My company transferred me to Busan.", expect: ["address-or-workplace"] },
  { id: "a-ko-3", lang: "ko-KR", text: "회사에서 발령이 나서요.", expect: ["address-or-workplace"] },
  { id: "a-en-4", lang: "en-US", text: "I changed jobs and I told immigration already.", expect: ["job-change-scope", "permission-or-report"] },
  { id: "a-ko-4", lang: "ko-KR", text: "근무처 변경은 신고했어요.", expect: ["permission-or-report-explicit"] },
  { id: "a-en-5", lang: "en-US", text: "I already did it.", recent: [{ text: "Is this about your extension of stay?" }], expect: ["stage-unclear"] },
  { id: "a-zh-3", lang: "zh-CN", text: "已经办好了。", recent: [{ text: "체류자격 변경 때문에 오셨어요?", lang: "ko-KR" }], expect: ["stage-unclear"] },
  { id: "a-en-6", lang: "en-US", text: "What is the deadline to leave?", expect: ["deadline-type"] },
  { id: "a-vi-2", lang: "vi-VN", text: "Tôi phải xuất cảnh đến khi nào?", expect: ["deadline-type"] },
  { id: "a-ko-5", lang: "ko-KR", text: "난민 결과 나왔어요.", expect: ["refugee-outcome"] },
  { id: "a-ru-2", lang: "ru-RU", text: "Я получил статус беженца? Мне дали бумагу.", expect: ["refugee-outcome"] },
  { id: "a-zh-4", lang: "zh-CN", text: "这是我的签证卡。", expect: ["visa-means-card"] },
  // Unambiguous — must stay quiet.
  { id: "n-ko-1", lang: "ko-KR", text: "체류기간 연장허가 신청하러 왔습니다.", expect: [] },
  { id: "n-ko-2", lang: "ko-KR", text: "외국인등록증을 잃어버려서 재발급 받으러 왔어요.", expect: [] },
  { id: "n-en-1", lang: "en-US", text: "I'd like to apply for a change of status of stay.", expect: [] },
  { id: "n-en-2", lang: "en-US", text: "Here is my passport.", expect: [] },
  { id: "n-en-3", lang: "en-US", text: "I moved house last week and need to report my new address.", expect: [] },
  { id: "n-zh-1", lang: "zh-CN", text: "我是来办理滞留期间延长的。", expect: [] },
  { id: "n-zh-2", lang: "zh-CN", text: "谢谢，再见。", expect: [] },
  { id: "n-vi-1", lang: "vi-VN", text: "Tôi muốn đặt lịch hẹn.", expect: [] },
  { id: "n-id-1", lang: "id-ID", text: "Berapa biayanya?", expect: [] },
  { id: "n-ru-1", lang: "ru-RU", text: "Я пришёл на приём.", expect: [] },
  { id: "n-ko-3", lang: "ko-KR", text: "출국기한이 언제까지인지 출국명령서에 적혀 있나요?", expect: [] },
  { id: "n-en-4", lang: "en-US", text: "I was recognized as a refugee last year.", expect: [] },
  { id: "n-th-1", lang: "th-TH", text: "ขอบคุณค่ะ", expect: [] },
  { id: "n-ko-4", lang: "ko-KR", text: "네, 알겠습니다.", recent: [{ text: "체류기간 연장 신청서 작성해 주세요." }], expect: [] },
  { id: "n-en-5", lang: "en-US", text: "I submitted the application last Monday.", expect: [] },
];

/* -------------------------------------------------------------------------- */
/* 3. Semantic                                                                */
/* -------------------------------------------------------------------------- */

const KO = "ko-KR";

export const SEMANTIC_CASES: SemanticCase[] = [
  {
    id: "s-ko-en-1", sourceLang: KO, targetLang: "en-US",
    source: "근무처를 변경하기 전에 허가를 받으셔야 합니다.",
    faithful: ["You need to get permission before changing your workplace.", "You must obtain approval before you change workplaces."],
    corrupted: [
      { text: "You can get permission before changing your workplace.", check: "obligation-to-permission", severity: "critical" },
      { text: "You need to report it before changing your workplace.", check: "concept-substituted", severity: "critical" },
    ],
  },
  {
    id: "s-ko-en-2", sourceLang: KO, targetLang: "en-US",
    source: "신청서는 접수되었고 아직 심사 중입니다.",
    faithful: ["Your application has been received and is still under review.", "We've received your application; it's still being reviewed."],
    corrupted: [
      { text: "Your application has been approved.", check: "concept-substituted", severity: "critical" },
      { text: "Your application was received and the review is completed.", check: "pending-to-completed", severity: "critical" },
    ],
  },
  {
    id: "s-ko-en-3", sourceLang: KO, targetLang: "en-US",
    source: "온라인으로 예약하셔도 됩니다.",
    faithful: ["You can book online.", "You may make an appointment online."],
    corrupted: [{ text: "You must book online.", check: "permission-to-obligation", severity: "critical" }],
  },
  {
    id: "s-ko-en-4", sourceLang: KO, targetLang: "en-US",
    source: "이 체류자격으로는 아르바이트를 할 수 없습니다.",
    faithful: ["You cannot work part-time with this residence status.", "With this residence status, you're not allowed to do part-time work."],
    corrupted: [{ text: "You can work part-time with this residence status.", check: "prohibition-to-permission", severity: "critical" }],
  },
  {
    id: "s-ko-en-5", sourceLang: KO, targetLang: "en-US",
    source: "서류가 부족하면 다시 오셔야 합니다.",
    faithful: ["If documents are missing, you'll have to come back.", "You need to come back if any documents are missing."],
    corrupted: [{ text: "You'll have to come back with more documents.", check: "condition-dropped", severity: "high" }],
  },
  {
    id: "s-ko-en-6", sourceLang: KO, targetLang: "en-US",
    source: "아마 2주 정도 걸릴 거예요.",
    faithful: ["It will probably take about two weeks.", "It might take around two weeks."],
    corrupted: [{ text: "It will take two weeks.", check: "unjustified-certainty", severity: "high" }],
  },
  {
    id: "s-ko-en-7", sourceLang: KO, targetLang: "en-US",
    source: "저희가 결과를 문자로 보내드립니다.",
    faithful: ["We will send you the result by text message.", "We'll text you the result."],
    corrupted: [{ text: "You need to send the result by text message.", check: "actor-changed", severity: "high" }],
  },
  {
    id: "s-ko-en-8", sourceLang: KO, targetLang: "en-US",
    source: "출국기한까지 출국하셔야 합니다.",
    faithful: ["You must leave Korea by the departure deadline.", "You need to depart by the departure deadline."],
    corrupted: [{ text: "You must leave Korea before your stay expires.", check: "concept-substituted", severity: "critical" }],
  },
  {
    id: "s-ko-en-9", sourceLang: KO, targetLang: "en-US",
    source: "인도적 체류 허가를 받으셨습니다.",
    faithful: ["You have received a humanitarian stay permit.", "You were granted humanitarian stay."],
    corrupted: [{ text: "You have been recognized as a refugee.", check: "concept-substituted", severity: "critical" }],
  },
  {
    id: "s-ko-en-10", sourceLang: KO, targetLang: "en-US",
    source: "체류자격 확인을 위해 여권을 보여 주세요.",
    faithful: ["Please show me your passport so I can check your residence status.", "Could you show your passport? I need to check your status of stay."],
    corrupted: [{ text: "Please show me your passport so I can check your residence card.", check: "concept-substituted", severity: "critical" }],
  },
  {
    id: "s-ko-zh-1", sourceLang: KO, targetLang: "zh-CN",
    source: "체류기간 만료 전에 연장 신청을 하셔야 합니다.",
    faithful: ["您必须在滞留期间到期前申请延长。", "到期之前需要申请延长滞留期间。"],
    corrupted: [{ text: "您可以在滞留期间到期前申请延长。", check: "obligation-to-permission", severity: "critical" }],
  },
  {
    id: "s-ko-zh-2", sourceLang: KO, targetLang: "zh-CN",
    source: "아직 처리 중입니다.",
    faithful: ["还在处理中。", "目前正在办理中。"],
    corrupted: [{ text: "已经办好了。", check: "pending-to-completed", severity: "critical" }],
  },
  {
    id: "s-ko-zh-3", sourceLang: KO, targetLang: "zh-CN",
    source: "출국명령이 내려졌습니다.",
    faithful: ["已对您下达出境命令。"],
    corrupted: [{ text: "您已被驱逐出境。", check: "concept-substituted", severity: "critical" }],
  },
  {
    id: "s-ko-vi-1", sourceLang: KO, targetLang: "vi-VN",
    source: "이 서류는 반드시 제출하셔야 합니다.",
    faithful: ["Bạn bắt buộc phải nộp giấy tờ này.", "Giấy tờ này bạn phải nộp."],
    corrupted: [{ text: "Bạn có thể nộp giấy tờ này.", check: "obligation-to-permission", severity: "critical" }],
  },
  {
    id: "s-ko-vi-2", sourceLang: KO, targetLang: "vi-VN",
    source: "오늘은 접수할 수 없습니다.",
    faithful: ["Hôm nay không thể tiếp nhận hồ sơ.", "Hôm nay chúng tôi không tiếp nhận được."],
    corrupted: [{ text: "Hôm nay có thể tiếp nhận hồ sơ.", check: "prohibition-to-permission", severity: "critical" }],
  },
  {
    id: "s-ko-vi-3", sourceLang: KO, targetLang: "vi-VN",
    source: "예약을 못 하시면 직접 방문하세요.",
    faithful: ["Nếu không đặt lịch được, vui lòng đến trực tiếp.", "Trường hợp không đặt được lịch hẹn thì hãy đến trực tiếp."],
    corrupted: [{ text: "Vui lòng đến trực tiếp.", check: "condition-dropped", severity: "high" }],
  },
  {
    id: "s-ko-id-1", sourceLang: KO, targetLang: "id-ID",
    source: "신청서를 다시 작성하셔야 합니다.",
    faithful: ["Anda harus mengisi formulir permohonan lagi.", "Formulirnya perlu diisi ulang."],
    corrupted: [{ text: "Anda boleh mengisi formulir permohonan lagi.", check: "obligation-to-permission", severity: "critical" }],
  },
  {
    id: "s-ko-id-2", sourceLang: KO, targetLang: "id-ID",
    source: "아마 다음 주에 나올 거예요.",
    faithful: ["Mungkin keluar minggu depan.", "Sepertinya akan keluar minggu depan."],
    corrupted: [{ text: "Akan keluar minggu depan.", check: "unjustified-certainty", severity: "high" }],
  },
  {
    id: "s-ko-ru-1", sourceLang: KO, targetLang: "ru-RU",
    source: "외국인등록증을 반드시 가져오셔야 합니다.",
    faithful: ["Вы обязательно должны принести карту регистрации иностранца.", "Нужно обязательно принести карту регистрации."],
    corrupted: [{ text: "Вы можете принести карту регистрации иностранца.", check: "obligation-to-permission", severity: "critical" }],
  },
  {
    id: "s-ko-ru-2", sourceLang: KO, targetLang: "ru-RU",
    source: "신청은 접수되었지만 아직 심사 중입니다.",
    faithful: ["Заявление принято, но ещё на рассмотрении.", "Ваше заявление принято к рассмотрению, решение ещё не принято."],
    corrupted: [{ text: "Ваше заявление одобрено.", check: "concept-substituted", severity: "critical" }],
  },
  {
    id: "s-ko-th-1", sourceLang: KO, targetLang: "th-TH",
    source: "여권을 꼭 가져오셔야 합니다.",
    faithful: ["คุณต้องนำหนังสือเดินทางมาด้วย", "จำเป็นต้องนำหนังสือเดินทางมา"],
    corrupted: [{ text: "คุณสามารถนำหนังสือเดินทางมาได้", check: "obligation-to-permission", severity: "critical" }],
  },
  {
    id: "s-en-ko-1", sourceLang: "en-US", targetLang: KO,
    source: "I applied for the extension last month.",
    faithful: ["지난달에 연장 신청했어요.", "저는 지난달에 연장을 신청했습니다."],
    corrupted: [{ text: "지난달에 연장 허가를 받았어요.", check: "concept-substituted", severity: "critical" }],
  },
  {
    id: "s-en-ko-2", sourceLang: "en-US", targetLang: KO,
    source: "I think I reported my new address.",
    faithful: ["새 주소를 신고한 것 같아요.", "아마 새 주소를 신고했을 거예요."],
    corrupted: [{ text: "새 주소를 신고했어요.", check: "unjustified-certainty", severity: "high" }],
  },
  {
    id: "s-en-ko-3", sourceLang: "en-US", targetLang: KO,
    source: "My application is still pending.",
    faithful: ["제 신청은 아직 심사 중이에요.", "신청한 건 아직 처리 중입니다."],
    corrupted: [{ text: "제 신청은 처리 완료됐어요.", check: "pending-to-completed", severity: "critical" }],
  },
  {
    id: "s-zh-ko-1", sourceLang: "zh-CN", targetLang: KO,
    source: "我已经提交申请了，但是还没批准。",
    faithful: ["이미 신청서를 냈는데 아직 허가는 안 났어요.", "신청은 이미 했지만 아직 승인이 안 됐어요."],
    corrupted: [{ text: "이미 신청했고 허가가 났어요.", check: "pending-to-completed", severity: "critical" }],
  },
  {
    id: "s-vi-ko-1", sourceLang: "vi-VN", targetLang: KO,
    source: "Nếu tôi đổi công ty thì tôi có phải khai báo không?",
    faithful: ["회사를 바꾸면 신고해야 하나요?", "제가 회사를 옮기면 신고를 해야 하나요?"],
    corrupted: [{ text: "회사를 바꿨는데 신고해야 하나요?", check: "condition-dropped", severity: "high" }],
  },
];
