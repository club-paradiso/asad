/**
 * Quick phrases — the zero-error path.
 *
 * The twenty-odd things a counter says all day, pre-written in every supported
 * language. Sending one does NOT call a model: it is a lookup, so it has no
 * latency and no variance and cannot be mistranslated.
 *
 * This is the most direct answer to "번역기 오류가 너무 많다". The phrases a
 * counter repeats forty times a day are exactly the ones that should never be
 * re-gambled on a model.
 *
 * Where a language is missing a translation the phrase falls back to the model
 * path rather than showing the Korean, so coverage gaps degrade quietly.
 */
export interface QuickPhrase {
  id: string;
  /** Which side would say it. */
  side: "host" | "guest" | "both";
  category: "greeting" | "wait" | "documents" | "clarify" | "closing" | "help";
  /** Translations by language code. `ko-KR` is the canonical source. */
  text: Record<string, string>;
}

/** Kept short: a phrase that needs scrolling is not a quick phrase. */
export const QUICK_PHRASES: QuickPhrase[] = [
  {
    id: "greeting",
    side: "host",
    category: "greeting",
    text: {
      "ko-KR": "안녕하세요. 무엇을 도와드릴까요?",
      "en-US": "Hello. How can I help you?",
      "zh-CN": "您好，请问需要什么帮助？",
      "zh-TW": "您好，請問需要什麼協助？",
      "ja-JP": "こんにちは。ご用件をお伺いします。",
      "vi-VN": "Xin chào. Tôi có thể giúp gì cho bạn?",
      "th-TH": "สวัสดีค่ะ มีอะไรให้ช่วยไหมคะ",
      "id-ID": "Halo. Ada yang bisa saya bantu?",
      "ru-RU": "Здравствуйте. Чем могу помочь?",
      "uz-UZ": "Assalomu alaykum. Sizga qanday yordam bera olaman?",
      "mn-MN": "Сайн байна уу. Би танд юугаар туслах вэ?",
      "ne-NP": "नमस्ते। म तपाईंलाई कसरी मद्दत गर्न सक्छु?",
      "es-ES": "Hola. ¿En qué puedo ayudarle?",
      "fr-FR": "Bonjour. Comment puis-je vous aider ?",
      "ar-SA": "مرحباً. كيف يمكنني مساعدتك؟",
      "hi-IN": "नमस्ते। मैं आपकी क्या मदद कर सकता हूँ?",
      "tr-TR": "Merhaba. Size nasıl yardımcı olabilirim?",
    },
  },
  {
    id: "wait-moment",
    side: "host",
    category: "wait",
    text: {
      "ko-KR": "잠시만 기다려 주세요.",
      "en-US": "One moment, please.",
      "zh-CN": "请稍等。",
      "zh-TW": "請稍等。",
      "ja-JP": "少々お待ちください。",
      "vi-VN": "Vui lòng đợi một chút.",
      "th-TH": "กรุณารอสักครู่",
      "id-ID": "Mohon tunggu sebentar.",
      "ru-RU": "Подождите, пожалуйста.",
      "uz-UZ": "Iltimos, biroz kuting.",
      "mn-MN": "Түр хүлээнэ үү.",
      "ne-NP": "कृपया एक छिन पर्खनुहोस्।",
      "es-ES": "Un momento, por favor.",
      "fr-FR": "Un instant, s'il vous plaît.",
      "ar-SA": "لحظة من فضلك.",
      "hi-IN": "कृपया एक क्षण प्रतीक्षा करें।",
      "tr-TR": "Bir dakika lütfen.",
    },
  },
  {
    id: "show-id",
    side: "host",
    category: "documents",
    text: {
      "ko-KR": "신분증이나 여권을 보여 주시겠어요?",
      "en-US": "Could you show me your ID or passport?",
      "zh-CN": "可以出示您的身份证或护照吗？",
      "zh-TW": "可以出示您的身分證或護照嗎？",
      "ja-JP": "身分証またはパスポートを見せていただけますか？",
      "vi-VN": "Bạn có thể cho tôi xem CMND hoặc hộ chiếu không?",
      "th-TH": "ขอดูบัตรประชาชนหรือหนังสือเดินทางได้ไหมคะ",
      "id-ID": "Bisakah Anda menunjukkan KTP atau paspor?",
      "ru-RU": "Покажите, пожалуйста, удостоверение личности или паспорт.",
      "uz-UZ": "Shaxsni tasdiqlovchi hujjat yoki pasportingizni koʻrsatasizmi?",
      "mn-MN": "Иргэний үнэмлэх эсвэл паспортоо үзүүлнэ үү.",
      "ne-NP": "कृपया आफ्नो परिचयपत्र वा राहदानी देखाउनुहोस्।",
      "es-ES": "¿Podría mostrarme su identificación o pasaporte?",
      "fr-FR": "Pourriez-vous me montrer votre pièce d'identité ou passeport ?",
      "ar-SA": "هل يمكنك إظهار بطاقة الهوية أو جواز السفر؟",
      "hi-IN": "क्या आप अपना पहचान पत्र या पासपोर्ट दिखा सकते हैं?",
      "tr-TR": "Kimliğinizi veya pasaportunuzu gösterebilir misiniz?",
    },
  },
  {
    id: "appointment",
    side: "host",
    category: "clarify",
    text: {
      "ko-KR": "예약하셨나요?",
      "en-US": "Do you have an appointment?",
      "zh-CN": "您有预约吗？",
      "zh-TW": "您有預約嗎？",
      "ja-JP": "ご予約はされていますか？",
      "vi-VN": "Bạn đã đặt hẹn chưa?",
      "th-TH": "คุณได้นัดหมายไว้หรือไม่คะ",
      "id-ID": "Apakah Anda sudah membuat janji?",
      "ru-RU": "У вас есть запись?",
      "uz-UZ": "Oldindan yozilganmisiz?",
      "mn-MN": "Та урьдчилан цаг авсан уу?",
      "ne-NP": "के तपाईंले अपोइन्टमेन्ट लिनुभएको छ?",
      "es-ES": "¿Tiene una cita?",
      "fr-FR": "Avez-vous un rendez-vous ?",
      "ar-SA": "هل لديك موعد؟",
      "hi-IN": "क्या आपका अपॉइंटमेंट है?",
      "tr-TR": "Randevunuz var mı?",
    },
  },
  {
    id: "staff-coming",
    side: "host",
    category: "wait",
    text: {
      "ko-KR": "담당자가 곧 올 겁니다.",
      "en-US": "Someone will be with you shortly.",
      "zh-CN": "工作人员马上就来。",
      "zh-TW": "工作人員馬上就來。",
      "ja-JP": "担当者がまもなく参ります。",
      "vi-VN": "Nhân viên phụ trách sẽ đến ngay.",
      "th-TH": "เจ้าหน้าที่จะมาในไม่ช้า",
      "id-ID": "Petugas akan segera datang.",
      "ru-RU": "Сотрудник скоро подойдёт.",
      "uz-UZ": "Mas'ul xodim tez orada keladi.",
      "mn-MN": "Хариуцсан ажилтан удахгүй ирнэ.",
      "ne-NP": "जिम्मेवार व्यक्ति चाँडै आउनुहुनेछ।",
      "es-ES": "Alguien le atenderá en breve.",
      "fr-FR": "Quelqu'un va vous recevoir sous peu.",
      "ar-SA": "سيأتي الموظف المسؤول قريباً.",
      "hi-IN": "संबंधित व्यक्ति जल्द ही आएंगे।",
      "tr-TR": "İlgili kişi birazdan gelecek.",
    },
  },
  {
    id: "write-it",
    side: "host",
    category: "clarify",
    text: {
      "ko-KR": "여기에 적어 주시겠어요?",
      "en-US": "Could you write it here?",
      "zh-CN": "可以写在这里吗？",
      "zh-TW": "可以寫在這裡嗎？",
      "ja-JP": "こちらにご記入いただけますか？",
      "vi-VN": "Bạn có thể viết vào đây không?",
      "th-TH": "ช่วยเขียนตรงนี้ได้ไหมคะ",
      "id-ID": "Bisakah Anda menuliskannya di sini?",
      "ru-RU": "Напишите здесь, пожалуйста.",
      "uz-UZ": "Shu yerga yozib bera olasizmi?",
      "mn-MN": "Энд бичиж өгнө үү.",
      "ne-NP": "कृपया यहाँ लेख्नुहोस्।",
      "es-ES": "¿Podría escribirlo aquí?",
      "fr-FR": "Pourriez-vous l'écrire ici ?",
      "ar-SA": "هل يمكنك كتابته هنا؟",
      "hi-IN": "क्या आप इसे यहाँ लिख सकते हैं?",
      "tr-TR": "Buraya yazabilir misiniz?",
    },
  },
  {
    id: "understood",
    side: "both",
    category: "clarify",
    text: {
      "ko-KR": "이해했습니다.",
      "en-US": "I understand.",
      "zh-CN": "我明白了。",
      "zh-TW": "我明白了。",
      "ja-JP": "わかりました。",
      "vi-VN": "Tôi hiểu rồi.",
      "th-TH": "เข้าใจแล้วค่ะ",
      "id-ID": "Saya mengerti.",
      "ru-RU": "Я понял.",
      "uz-UZ": "Tushundim.",
      "mn-MN": "Ойлголоо.",
      "ne-NP": "मैले बुझें।",
      "es-ES": "Entiendo.",
      "fr-FR": "Je comprends.",
      "ar-SA": "فهمت.",
      "hi-IN": "मैं समझ गया।",
      "tr-TR": "Anladım.",
    },
  },
  {
    id: "say-again",
    side: "both",
    category: "clarify",
    text: {
      "ko-KR": "다시 한번 말씀해 주시겠어요?",
      "en-US": "Could you say that again?",
      "zh-CN": "可以再说一遍吗？",
      "zh-TW": "可以再說一遍嗎？",
      "ja-JP": "もう一度お願いできますか？",
      "vi-VN": "Bạn có thể nói lại không?",
      "th-TH": "ช่วยพูดอีกครั้งได้ไหมคะ",
      "id-ID": "Bisa diulangi?",
      "ru-RU": "Повторите, пожалуйста.",
      "uz-UZ": "Yana bir marta aytasizmi?",
      "mn-MN": "Дахин хэлнэ үү.",
      "ne-NP": "कृपया फेरि भन्नुहोस्।",
      "es-ES": "¿Podría repetirlo?",
      "fr-FR": "Pouvez-vous répéter ?",
      "ar-SA": "هل يمكنك تكرار ذلك؟",
      "hi-IN": "क्या आप दोबारा कह सकते हैं?",
      "tr-TR": "Tekrar eder misiniz?",
    },
  },
  {
    id: "need-help",
    side: "guest",
    category: "help",
    text: {
      "ko-KR": "도움이 필요합니다.",
      "en-US": "I need help.",
      "zh-CN": "我需要帮助。",
      "zh-TW": "我需要協助。",
      "ja-JP": "助けが必要です。",
      "vi-VN": "Tôi cần giúp đỡ.",
      "th-TH": "ฉันต้องการความช่วยเหลือ",
      "id-ID": "Saya butuh bantuan.",
      "ru-RU": "Мне нужна помощь.",
      "uz-UZ": "Menga yordam kerak.",
      "mn-MN": "Надад тусламж хэрэгтэй.",
      "ne-NP": "मलाई मद्दत चाहिन्छ।",
      "es-ES": "Necesito ayuda.",
      "fr-FR": "J'ai besoin d'aide.",
      "ar-SA": "أحتاج إلى مساعدة.",
      "hi-IN": "मुझे मदद चाहिए।",
      "tr-TR": "Yardıma ihtiyacım var.",
    },
  },
  {
    id: "dont-understand",
    side: "guest",
    category: "clarify",
    text: {
      "ko-KR": "이해하지 못했습니다.",
      "en-US": "I don't understand.",
      "zh-CN": "我不明白。",
      "zh-TW": "我不明白。",
      "ja-JP": "わかりません。",
      "vi-VN": "Tôi không hiểu.",
      "th-TH": "ฉันไม่เข้าใจ",
      "id-ID": "Saya tidak mengerti.",
      "ru-RU": "Я не понимаю.",
      "uz-UZ": "Tushunmadim.",
      "mn-MN": "Би ойлгохгүй байна.",
      "ne-NP": "मैले बुझिनँ।",
      "es-ES": "No entiendo.",
      "fr-FR": "Je ne comprends pas.",
      "ar-SA": "لا أفهم.",
      "hi-IN": "मैं नहीं समझा।",
      "tr-TR": "Anlamıyorum.",
    },
  },
  {
    id: "thank-you",
    side: "both",
    category: "closing",
    text: {
      "ko-KR": "감사합니다.",
      "en-US": "Thank you.",
      "zh-CN": "谢谢。",
      "zh-TW": "謝謝。",
      "ja-JP": "ありがとうございます。",
      "vi-VN": "Cảm ơn bạn.",
      "th-TH": "ขอบคุณค่ะ",
      "id-ID": "Terima kasih.",
      "ru-RU": "Спасибо.",
      "uz-UZ": "Rahmat.",
      "mn-MN": "Баярлалаа.",
      "ne-NP": "धन्यवाद।",
      "es-ES": "Gracias.",
      "fr-FR": "Merci.",
      "ar-SA": "شكراً لك.",
      "hi-IN": "धन्यवाद।",
      "tr-TR": "Teşekkürler.",
    },
  },
  {
    id: "all-done",
    side: "host",
    category: "closing",
    text: {
      "ko-KR": "다 처리되었습니다. 안녕히 가세요.",
      "en-US": "All done. Have a good day.",
      "zh-CN": "都办好了，请慢走。",
      "zh-TW": "都辦好了，請慢走。",
      "ja-JP": "手続きは完了しました。お気をつけて。",
      "vi-VN": "Đã xong. Chúc bạn một ngày tốt lành.",
      "th-TH": "เรียบร้อยแล้วค่ะ ขอให้เป็นวันที่ดี",
      "id-ID": "Sudah selesai. Semoga harimu menyenangkan.",
      "ru-RU": "Всё готово. Хорошего дня.",
      "uz-UZ": "Hammasi tayyor. Yaxshi kun tilayman.",
      "mn-MN": "Бүх зүйл боллоо. Сайхан өдөр өнгөрүүлээрэй.",
      "ne-NP": "सबै काम सकियो। शुभ दिन।",
      "es-ES": "Todo listo. Que tenga un buen día.",
      "fr-FR": "C'est terminé. Bonne journée.",
      "ar-SA": "تم كل شيء. أتمنى لك يوماً سعيداً.",
      "hi-IN": "सब हो गया। आपका दिन शुभ हो।",
      "tr-TR": "Her şey tamam. İyi günler.",
    },
  },
];

/** Phrases one side can send. */
export const phrasesFor = (side: "host" | "guest"): QuickPhrase[] =>
  QUICK_PHRASES.filter((p) => p.side === side || p.side === "both");

/**
 * Resolve a phrase into a source/target pair.
 *
 * Returns `null` when either language is missing a translation, so the caller
 * falls back to the model path instead of showing the wrong language.
 */
export function resolveQuickPhrase(
  id: string,
  sourceLang: string,
  targetLang: string,
): { originalText: string; translatedText: string } | null {
  const phrase = QUICK_PHRASES.find((p) => p.id === id);
  if (!phrase) return null;
  const originalText = phrase.text[sourceLang] ?? phrase.text[baseOf(sourceLang)];
  const translatedText = phrase.text[targetLang] ?? phrase.text[baseOf(targetLang)];
  if (!originalText || !translatedText) return null;
  return { originalText, translatedText };
}

/**
 * The phrase in one language, or undefined when it is not covered.
 *
 * Used by the picker to label a button in the sender's own language; a phrase
 * with no label is not offered, because a button whose text you cannot read is
 * a button you press by accident.
 */
export const phraseText = (phrase: QuickPhrase, lang: string): string | undefined =>
  phrase.text[lang] ?? phrase.text[baseOf(lang)];

/** `en` → the first entry whose code starts with `en-`. */
function baseOf(code: string): string {
  const base = code.split("-")[0];
  const match = Object.keys(QUICK_PHRASES[0].text).find((k) => k.startsWith(`${base}-`));
  return match ?? code;
}

export const quickPhraseCoverage = (lang: string): number => {
  const covered = QUICK_PHRASES.filter((p) => p.text[lang] ?? p.text[baseOf(lang)]).length;
  return covered / QUICK_PHRASES.length;
};
