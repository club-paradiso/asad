/**
 * Synthetic administrative-desk corpus for Counter Mode quality checks.
 *
 * Every line here was written for this benchmark. Nothing is taken from a real
 * applicant, case file or transcript. The scenarios are the ones an
 * immigration or public-service desk handles all day: extensions, status
 * changes, registration cards, address and workplace changes, documents,
 * appointments, fees, expiry dates, refugee procedure terminology, corrections
 * and misunderstandings.
 *
 * Each case pairs a source utterance with renderings a faithful translator
 * might produce and with the specific corruption that matters at a counter.
 * The deterministic validators have to accept every faithful rendering and
 * reject every corruption; the benchmark reports where they do not, as false
 * positives and false negatives respectively, so a change to the validators
 * can be judged on both at once.
 */

export type Defect =
  | "status-code"
  | "negation"
  | "date"
  | "time"
  | "number"
  | "money"
  | "invented-value"
  | "identifier";

export interface QualityCase {
  id: string;
  domain:
    | "extension"
    | "status-change"
    | "registration"
    | "address"
    | "workplace"
    | "documents"
    | "appointment"
    | "fees"
    | "expiry"
    | "refugee"
    | "correction"
    | "clarification"
    | "general";
  sourceLang: string;
  targetLang: string;
  source: string;
  faithful: string[];
  corrupted: Array<{ text: string; defect: Defect }>;
}

const KO = "ko-KR";
const EN = "en-US";

export const QUALITY_CORPUS: QualityCase[] = [
  /* --- Korean → English --------------------------------------------------- */
  {
    id: "ext-ko-en-1", domain: "extension", sourceLang: KO, targetLang: EN,
    source: "체류기간 만료일 전에 연장 신청을 하셔야 합니다.",
    faithful: [
      "You must apply for an extension before the expiration date of your period of stay.",
      "You need to apply for the extension before your period of stay expires.",
    ],
    corrupted: [
      { text: "You must apply for an extension within 30 days before your period of stay expires.", defect: "invented-value" },
      { text: "You do not need to apply for an extension before your period of stay expires.", defect: "negation" },
    ],
  },
  {
    id: "ext-ko-en-2", domain: "extension", sourceLang: KO, targetLang: EN,
    source: "만료일이 2026년 11월 3일이면 10월 중에 예약하세요.",
    faithful: [
      "If the expiration date is November 3, 2026, please book an appointment in October.",
      "If it expires on 3 November 2026, make a reservation during October.",
    ],
    corrupted: [
      { text: "If the expiration date is November 13, 2026, please book an appointment in October.", defect: "date" },
      { text: "If the expiration date is November 3, 2025, please book an appointment in October.", defect: "date" },
    ],
  },
  {
    id: "status-ko-en-1", domain: "status-change", sourceLang: KO, targetLang: EN,
    source: "D-2에서 D-10으로 체류자격을 변경하시려는 거죠?",
    faithful: [
      "You want to change your residence status from D-2 to D-10, right?",
      "So you'd like to change your status of stay from D-2 to D-10?",
    ],
    corrupted: [
      { text: "You want to change your residence status from D-2 to D-4, right?", defect: "status-code" },
      { text: "You want to change your residence status from D-2 to E-10, right?", defect: "status-code" },
      { text: "You want to change your residence status, right?", defect: "status-code" },
    ],
  },
  {
    id: "status-ko-en-2", domain: "status-change", sourceLang: KO, targetLang: EN,
    source: "E-7은 가능하지만 F-7은 존재하지 않는 체류자격입니다.",
    faithful: ["E-7 is possible, but F-7 is not a residence status that exists."],
    corrupted: [{ text: "E-7 is possible and is a residence status that exists.", defect: "negation" }],
  },
  {
    id: "reg-ko-en-1", domain: "registration", sourceLang: KO, targetLang: EN,
    source: "외국인등록증은 신청 후 약 3주 뒤에 받으실 수 있습니다.",
    faithful: [
      "You can receive your residence card about 3 weeks after applying.",
      "You can get the foreigner registration card about three weeks after you apply.",
    ],
    corrupted: [
      { text: "You can receive your residence card about 2 weeks after applying.", defect: "number" },
      { text: "You can receive your residence card about 3 days after applying.", defect: "invented-value" },
    ],
  },
  {
    id: "addr-ko-en-1", domain: "address", sourceLang: KO, targetLang: EN,
    source: "이사하신 날부터 15일 이내에 체류지 변경 신고를 하셔야 합니다.",
    faithful: [
      "You must report the change of residence within 15 days of the day you moved.",
      "Within 15 days of moving, you have to report your change of address.",
    ],
    corrupted: [
      { text: "You must report the change of residence within 14 days of the day you moved.", defect: "number" },
      { text: "You must report the change of residence within 15 days of the day you moved, or pay a 100,000 won fine.", defect: "invented-value" },
    ],
  },
  {
    id: "work-ko-en-1", domain: "workplace", sourceLang: KO, targetLang: EN,
    source: "근무처를 변경하셨는데 아직 신고하지 않으셨나요?",
    faithful: [
      "You changed your workplace but have not reported it yet?",
      "You've changed workplace and haven't reported it yet, is that right?",
    ],
    corrupted: [{ text: "You changed your workplace and have already reported it?", defect: "negation" }],
  },
  {
    id: "docs-ko-en-1", domain: "documents", sourceLang: KO, targetLang: EN,
    source: "여권, 외국인등록증, 통합신청서 1부, 사진 1장이 필요합니다.",
    faithful: [
      "You need your passport, residence card, one integrated application form, and one photo.",
      "You will need a passport, your residence card, 1 integrated application form and 1 photo.",
    ],
    corrupted: [
      { text: "You need your passport, residence card, two integrated application forms, and one photo.", defect: "number" },
      { text: "You need your passport, residence card, one integrated application form, one photo, and a 60,000 won fee.", defect: "invented-value" },
    ],
  },
  {
    id: "appt-ko-en-1", domain: "appointment", sourceLang: KO, targetLang: EN,
    source: "예약은 하이코리아에서 하시고, 오후 2시 30분에 2번 창구로 오세요.",
    faithful: [
      "Please book on HiKorea and come to counter 2 at 2:30 PM.",
      "Make the appointment on HiKorea, then come to counter 2 at 14:30.",
      "Book through HiKorea and come to the second counter at 2:30 p.m.",
    ],
    corrupted: [
      { text: "Please book on HiKorea and come to counter 2 at 12:30 PM.", defect: "time" },
      { text: "Please book on HiKorea and come to counter 3 at 2:30 PM.", defect: "number" },
      { text: "Please book on HiKorea and come to counter 2 at 2:30 AM.", defect: "time" },
    ],
  },
  {
    id: "fee-ko-en-1", domain: "fees", sourceLang: KO, targetLang: EN,
    source: "수수료는 6만 원이고 카드로 내실 수 있습니다.",
    faithful: [
      "The fee is 60,000 won and you can pay by card.",
      "The fee is ₩60,000; card payment is accepted.",
    ],
    corrupted: [
      { text: "The fee is 6,000 won and you can pay by card.", defect: "money" },
      { text: "The fee is 60,000 won and you cannot pay by card.", defect: "negation" },
    ],
  },
  {
    id: "fee-ko-en-2", domain: "fees", sourceLang: KO, targetLang: EN,
    source: "연장 수수료 6만 원과 등록증 재발급 3만 원, 합해서 9만 원입니다.",
    faithful: ["The extension fee is 60,000 won and reissuing the card is 30,000 won, 90,000 won in total."],
    corrupted: [{ text: "The extension fee is 60,000 won and reissuing the card is 30,000 won, 80,000 won in total.", defect: "money" }],
  },
  {
    id: "exp-ko-en-1", domain: "expiry", sourceLang: KO, targetLang: EN,
    source: "체류기간이 3월 15일에 끝나니까 그 전에 오셔야 해요.",
    faithful: [
      "Your period of stay ends on March 15, so you need to come before then.",
      "Your stay ends on the 15th of March, so please come before that.",
    ],
    corrupted: [{ text: "Your period of stay ends on May 15, so you need to come before then.", defect: "date" }],
  },
  {
    id: "ref-ko-en-1", domain: "refugee", sourceLang: KO, targetLang: EN,
    source: "난민 면접 날짜는 통지서에 적혀 있고, 못 오시면 미리 연락하셔야 합니다.",
    faithful: [
      "The refugee interview date is written on the notice, and if you cannot come you must contact us in advance.",
    ],
    corrupted: [
      { text: "The refugee interview date is written on the notice, and if you come you must contact us in advance.", defect: "negation" },
    ],
  },
  {
    id: "corr-ko-en-1", domain: "correction", sourceLang: KO, targetLang: EN,
    source: "아니요, 3시가 아니라 13시입니다.",
    faithful: ["No, not 3 o'clock — 13:00.", "No, it is not 3 PM, it's 13:00."],
    corrupted: [{ text: "Yes, 3 o'clock, 13:00.", defect: "negation" }],
  },
  {
    id: "clar-ko-en-1", domain: "clarification", sourceLang: KO, targetLang: EN,
    source: "죄송하지만 이해하지 못했어요. 다시 한 번 말씀해 주시겠어요?",
    faithful: ["Sorry, I did not understand. Could you say that once more?"],
    corrupted: [{ text: "Sorry, I understood. Could you say that once more?", defect: "negation" }],
  },
  {
    id: "gen-ko-en-1", domain: "general", sourceLang: KO, targetLang: EN,
    source: "접수번호 A-2024-10358로 접수되었습니다.",
    faithful: ["Your application has been received under receipt number A-2024-10358."],
    corrupted: [{ text: "Your application has been received under receipt number A-2024-10538.", defect: "identifier" }],
  },

  /* --- English → Korean --------------------------------------------------- */
  {
    id: "ext-en-ko-1", domain: "extension", sourceLang: EN, targetLang: KO,
    source: "My D-2 visa expires on 2026-12-20 and I haven't applied for the extension yet.",
    faithful: ["제 D-2 비자는 2026년 12월 20일에 만료되는데 아직 연장 신청을 하지 않았어요."],
    corrupted: [
      { text: "제 D-2 비자는 2026년 12월 20일에 만료되는데 연장 신청을 했어요.", defect: "negation" },
      { text: "제 D-4 비자는 2026년 12월 20일에 만료되는데 아직 연장 신청을 하지 않았어요.", defect: "status-code" },
      { text: "제 D-2 비자는 2026년 12월 2일에 만료되는데 아직 연장 신청을 하지 않았어요.", defect: "date" },
    ],
  },
  {
    id: "docs-en-ko-1", domain: "documents", sourceLang: EN, targetLang: KO,
    source: "Please bring your Alien Registration Card and two passport photos.",
    faithful: ["외국인등록증과 여권 사진 2장을 가져오세요.", "외국인등록증과 여권용 사진 두 장을 가져와 주세요."],
    corrupted: [{ text: "외국인등록증과 여권 사진 3장을 가져오세요.", defect: "number" }],
  },
  {
    id: "work-en-ko-1", domain: "workplace", sourceLang: EN, targetLang: KO,
    source: "I did not change my workplace; I only moved house.",
    faithful: ["근무처는 바꾸지 않았고, 집만 이사했어요."],
    corrupted: [{ text: "근무처를 바꿨고 집도 이사했어요.", defect: "negation" }],
  },
  {
    id: "appt-en-ko-1", domain: "appointment", sourceLang: EN, targetLang: KO,
    source: "My appointment is at 3 PM on Monday, counter No. 4.",
    faithful: ["제 예약은 월요일 오후 3시, 4번 창구입니다."],
    corrupted: [
      { text: "제 예약은 월요일 오전 3시, 4번 창구입니다.", defect: "time" },
      { text: "제 예약은 월요일 오후 3시, 5번 창구입니다.", defect: "number" },
    ],
  },
  {
    id: "fee-en-ko-1", domain: "fees", sourceLang: EN, targetLang: KO,
    source: "Is the fee 30,000 won or 60,000 won?",
    faithful: ["수수료가 3만 원인가요, 6만 원인가요?", "수수료는 30,000원인가요 60,000원인가요?"],
    corrupted: [{ text: "수수료가 3만 원인가요, 16만 원인가요?", defect: "money" }],
  },
  {
    id: "name-en-ko-1", domain: "registration", sourceLang: EN, targetLang: KO,
    source: "My name is Nguyen Van An and my card number is 123456-7890123.",
    faithful: ["제 이름은 Nguyen Van An이고 등록번호는 123456-7890123입니다."],
    corrupted: [{ text: "제 이름은 Nguyen Van An이고 등록번호는 123456-7890128입니다.", defect: "identifier" }],
  },

  /* --- Other pairs -------------------------------------------------------- */
  {
    id: "status-ko-vi-1", domain: "status-change", sourceLang: KO, targetLang: "vi-VN",
    source: "E-7 비자로 변경하시려는 거죠? 서류는 2부 필요합니다.",
    faithful: ["Bạn muốn chuyển sang visa E-7, đúng không? Cần 2 bộ hồ sơ.", "Bạn muốn đổi sang visa E-7 phải không? Cần hai bộ hồ sơ."],
    corrupted: [
      { text: "Bạn muốn chuyển sang visa E-9, đúng không? Cần 2 bộ hồ sơ.", defect: "status-code" },
      { text: "Bạn muốn chuyển sang visa E-7, đúng không? Cần 3 bộ hồ sơ.", defect: "number" },
    ],
  },
  {
    id: "work-vi-ko-1", domain: "workplace", sourceLang: "vi-VN", targetLang: KO,
    source: "Tôi chưa báo cáo việc đổi chỗ làm.",
    faithful: ["저는 근무처 변경을 아직 신고하지 않았습니다."],
    corrupted: [{ text: "저는 근무처 변경을 신고했습니다.", defect: "negation" }],
  },
  {
    id: "appt-vi-ko-1", domain: "appointment", sourceLang: "vi-VN", targetLang: KO,
    source: "Bạn có hẹn lúc 10 giờ 30 không?",
    faithful: ["10시 30분에 예약하셨나요?", "오전 10시 반에 예약이 있으신가요?"],
    corrupted: [{ text: "10시 13분에 예약하셨나요?", defect: "time" }],
  },
  {
    id: "exp-ko-zh-1", domain: "expiry", sourceLang: KO, targetLang: "zh-CN",
    source: "체류기간은 2026년 9월 7일까지이고, 그 전에 연장해야 합니다.",
    faithful: ["您的居留期限到2026年9月7日，必须在此之前办理延期。", "居留期限至 2026-09-07，需要在那之前延期。"],
    corrupted: [
      { text: "您的居留期限到2026年9月17日，必须在此之前办理延期。", defect: "date" },
      { text: "您的居留期限到2026年9月7日，不必在此之前办理延期。", defect: "negation" },
    ],
  },
  {
    id: "docs-zh-ko-1", domain: "documents", sourceLang: "zh-CN", targetLang: KO,
    source: "我没有带护照，是不是今天不能办理？",
    faithful: ["여권을 안 가져왔는데, 오늘은 처리할 수 없나요?"],
    corrupted: [{ text: "여권을 가져왔는데, 오늘 처리할 수 있나요?", defect: "negation" }],
  },
  {
    id: "fee-ko-ja-1", domain: "fees", sourceLang: KO, targetLang: "ja-JP",
    source: "수수료는 6만 원이고 무료가 아닙니다.",
    faithful: ["手数料は6万ウォンで、無料ではありません。"],
    corrupted: [{ text: "手数料は6万ウォンで、無料です。", defect: "negation" }],
  },
  {
    id: "appt-ko-ja-1", domain: "appointment", sourceLang: KO, targetLang: "ja-JP",
    source: "오후 3시에 3번 창구로 오세요.",
    faithful: ["午後3時に3番窓口へお越しください。", "15:00に3番窓口へ来てください。"],
    corrupted: [{ text: "午前3時に3番窓口へお越しください。", defect: "time" }],
  },
  {
    id: "ext-ko-ru-1", domain: "extension", sourceLang: KO, targetLang: "ru-RU",
    source: "연장 신청은 만료일 2026년 11월 3일 전에 하셔야 하고, 수수료는 6만 원입니다.",
    faithful: ["Заявление на продление нужно подать до 3 ноября 2026 г., срок истечения; пошлина 60 000 вон."],
    corrupted: [
      { text: "Заявление на продление нужно подать до 13 ноября 2026 г.; пошлина 60 000 вон.", defect: "date" },
      { text: "Заявление на продление не нужно подавать до 3 ноября 2026 г.; пошлина 60 000 вон.", defect: "negation" },
    ],
  },
  {
    id: "addr-ru-ko-1", domain: "address", sourceLang: "ru-RU", targetLang: KO,
    source: "Я не менял адрес, только место работы.",
    faithful: ["주소는 바꾸지 않았고, 근무처만 바꿨습니다."],
    corrupted: [{ text: "주소를 바꿨고, 근무처도 바꿨습니다.", defect: "negation" }],
  },
  {
    id: "status-ko-ar-1", domain: "status-change", sourceLang: KO, targetLang: "ar-SA",
    source: "D-10 비자이고 수수료는 13만 원입니다.",
    faithful: ["إنها تأشيرة D-10 والرسوم 130,000 وون.", "تأشيرة D-10، الرسوم 130000 وون."],
    corrupted: [
      { text: "إنها تأشيرة D-2 والرسوم 130,000 وون.", defect: "status-code" },
      { text: "إنها تأشيرة D-10 والرسوم 13,000 وون.", defect: "money" },
    ],
  },
  {
    id: "docs-ar-ko-1", domain: "documents", sourceLang: "ar-SA", targetLang: KO,
    source: "لم أحضر جواز السفر اليوم.",
    faithful: ["오늘 여권을 가져오지 않았어요."],
    corrupted: [{ text: "오늘 여권을 가져왔어요.", defect: "negation" }],
  },
  {
    id: "appt-ko-th-1", domain: "appointment", sourceLang: KO, targetLang: "th-TH",
    source: "예약 시간은 오후 2시 30분이고 2번 창구입니다.",
    faithful: ["เวลานัดคือ 14:30 ที่ช่องบริการหมายเลข 2"],
    corrupted: [{ text: "เวลานัดคือ 14:30 ที่ช่องบริการหมายเลข 3", defect: "number" }],
  },
  {
    id: "neg-th-ko-1", domain: "workplace", sourceLang: "th-TH", targetLang: KO,
    source: "ฉันยังไม่ได้แจ้งเปลี่ยนที่ทำงาน",
    faithful: ["근무처 변경을 아직 신고하지 않았어요."],
    corrupted: [{ text: "근무처 변경을 신고했어요.", defect: "negation" }],
  },
  {
    id: "fee-ko-id-1", domain: "fees", sourceLang: KO, targetLang: "id-ID",
    source: "수수료는 3만 원이고 현금은 받지 않습니다.",
    faithful: ["Biayanya 30.000 won dan kami tidak menerima uang tunai."],
    corrupted: [
      { text: "Biayanya 30.000 won dan kami menerima uang tunai.", defect: "negation" },
      { text: "Biayanya 300.000 won dan kami tidak menerima uang tunai.", defect: "money" },
    ],
  },
  {
    id: "exp-ko-mn-1", domain: "expiry", sourceLang: KO, targetLang: "mn-MN",
    source: "체류기간이 2026년 9월 7일에 만료되고, 아직 연장하지 않으셨어요.",
    faithful: ["Таны оршин суух хугацаа 2026-09-07-нд дуусах бөгөөд та хараахан сунгуулаагүй байна."],
    corrupted: [{ text: "Таны оршин суух хугацаа 2026-09-17-нд дуусах бөгөөд та хараахан сунгуулаагүй байна.", defect: "date" }],
  },
  {
    id: "docs-ko-uz-1", domain: "documents", sourceLang: KO, targetLang: "uz-UZ",
    source: "E-9 비자이고 서류 2부가 필요합니다.",
    faithful: ["E-9 viza, 2 nusxa hujjat kerak.", "E-9 vizasi va ikki nusxa hujjat kerak."],
    corrupted: [{ text: "E-7 viza, 2 nusxa hujjat kerak.", defect: "status-code" }],
  },
  {
    id: "appt-ko-hi-1", domain: "appointment", sourceLang: KO, targetLang: "hi-IN",
    source: "오후 3시에 4번 창구로 오세요.",
    faithful: ["दोपहर 3 बजे काउंटर 4 पर आइए।", "15:00 बजे काउंटर 4 पर आएँ।"],
    corrupted: [{ text: "दोपहर 3 बजे काउंटर 5 पर आइए।", defect: "number" }],
  },
  {
    id: "neg-hi-ko-1", domain: "documents", sourceLang: "hi-IN", targetLang: KO,
    source: "मैं आज पासपोर्ट नहीं लाया।",
    faithful: ["오늘 여권을 가져오지 않았어요."],
    corrupted: [{ text: "오늘 여권을 가져왔어요.", defect: "negation" }],
  },
  {
    id: "exp-ko-tw-1", domain: "expiry", sourceLang: KO, targetLang: "zh-TW",
    source: "체류기간은 2026년 9월 7일까지입니다.",
    faithful: ["居留期限到2026年9月7日。"],
    corrupted: [{ text: "居留期限到2026年9月27日。", defect: "date" }],
  },
  {
    id: "mixed-ko-en-1", domain: "general", sourceLang: KO, targetLang: EN,
    source: "HiKorea에서 visa extension 예약했는데 1345에 전화해도 되나요?",
    faithful: ["I booked a visa extension on HiKorea; can I also call 1345?"],
    corrupted: [{ text: "I booked a visa extension on HiKorea; can I also call 1346?", defect: "identifier" }],
  },
  {
    id: "quiet-ko-en-1", domain: "general", sourceLang: KO, targetLang: EN,
    source: "잠시만 기다려 주세요.",
    faithful: ["One moment, please.", "Please wait a moment."],
    corrupted: [{ text: "Please wait at counter 7.", defect: "invented-value" }],
  },
  {
    id: "unfinished-ko-en-1", domain: "clarification", sourceLang: KO, targetLang: EN,
    source: "회사를 바꿨는데 신고는…",
    faithful: ["I changed companies, but the report…", "I changed jobs, and as for reporting it…"],
    corrupted: [{ text: "I changed companies but did not report it.", defect: "negation" }],
  },
];
