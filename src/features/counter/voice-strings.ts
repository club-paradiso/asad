import type { CounterVoiceFailure } from "./counter-speech";

export interface CounterVoiceStrings {
  speak: string;
  connecting: string;
  listening: string;
  finishing: string;
  translating: string;
  fallback: string;
  confirmTranscript: (text: string) => string;
  yes: string;
  speakAgain: string;
  failure: (failure: CounterVoiceFailure) => string | null;
}

const createFailureCopy = (copy: {
  permission: string;
  noSpeech: string;
  unavailable: string;
  failed: string;
}) => (failure: CounterVoiceFailure): string | null => {
  if (failure === "stopped") return null;
  if (failure === "permission") return copy.permission;
  if (failure === "no-speech") return copy.noSpeech;
  if (failure === "unavailable") return copy.unavailable;
  return copy.failed;
};

const EN: CounterVoiceStrings = {
  speak: "Speak",
  connecting: "Getting ready…",
  listening: "Listening",
  finishing: "Got it",
  translating: "Translating…",
  fallback: "Voice input switched automatically. Please keep speaking.",
  confirmTranscript: (text) => `Is “${text}” correct?`,
  yes: "Yes",
  speakAgain: "Speak again",
  failure: createFailureCopy({
    permission: "The microphone is blocked. Allow access or type your message.",
    noSpeech: "Nothing was heard. Try again or type your message.",
    unavailable: "Voice input is unavailable. Please type your message.",
    failed: "Voice input stopped. Try again or type your message.",
  }),
};

const COPY: Record<string, CounterVoiceStrings> = {
  ko: {
    speak: "말하기",
    connecting: "준비 중…",
    listening: "듣고 있어요",
    finishing: "들었어요",
    translating: "번역 중…",
    fallback: "음성 연결을 자동으로 바꿨어요. 계속 말씀해 주세요.",
    confirmTranscript: (text) => `“${text}” 맞나요?`,
    yes: "맞아요",
    speakAgain: "다시 말하기",
    failure: createFailureCopy({
      permission: "마이크를 사용할 수 없습니다. 권한을 허용하거나 직접 입력해 주세요.",
      noSpeech: "아무 말도 들리지 않았어요. 다시 말하거나 직접 입력해 주세요.",
      unavailable: "이 기기에서는 음성 입력을 사용할 수 없어요. 직접 입력해 주세요.",
      failed: "음성 입력이 멈췄어요. 다시 시도하거나 직접 입력해 주세요.",
    }),
  },
  zh: {
    speak: "说话",
    connecting: "准备中…",
    listening: "正在听",
    finishing: "听到了",
    translating: "翻译中…",
    fallback: "已自动切换语音输入。请继续说话。",
    confirmTranscript: (text) => `“${text}”对吗？`,
    yes: "对",
    speakAgain: "重新说",
    failure: createFailureCopy({
      permission: "无法使用麦克风。请允许访问或直接输入。",
      noSpeech: "没有听到内容。请重试或直接输入。",
      unavailable: "此设备无法使用语音输入。请直接输入。",
      failed: "语音输入已停止。请重试或直接输入。",
    }),
  },
  ja: {
    speak: "話す",
    connecting: "準備中…",
    listening: "聞いています",
    finishing: "聞き取りました",
    translating: "翻訳中…",
    fallback: "音声入力を自動で切り替えました。そのまま話してください。",
    confirmTranscript: (text) => `「${text}」で合っていますか？`,
    yes: "はい",
    speakAgain: "もう一度話す",
    failure: createFailureCopy({
      permission: "マイクを使用できません。許可するか、直接入力してください。",
      noSpeech: "音声が聞き取れませんでした。もう一度話すか入力してください。",
      unavailable: "この端末では音声入力を使用できません。直接入力してください。",
      failed: "音声入力が停止しました。再試行するか直接入力してください。",
    }),
  },
  vi: {
    speak: "Nói",
    connecting: "Đang chuẩn bị…",
    listening: "Đang nghe",
    finishing: "Đã nghe",
    translating: "Đang dịch…",
    fallback: "Đã tự động đổi cách nhập giọng nói. Hãy tiếp tục nói.",
    confirmTranscript: (text) => `“${text}” có đúng không?`,
    yes: "Đúng",
    speakAgain: "Nói lại",
    failure: createFailureCopy({
      permission: "Không dùng được micrô. Hãy cho phép hoặc nhập bằng bàn phím.",
      noSpeech: "Không nghe thấy gì. Hãy thử lại hoặc nhập bằng bàn phím.",
      unavailable: "Thiết bị này không hỗ trợ nhập giọng nói. Hãy nhập bằng bàn phím.",
      failed: "Nhập giọng nói đã dừng. Hãy thử lại hoặc nhập bằng bàn phím.",
    }),
  },
  th: {
    speak: "พูด",
    connecting: "กำลังเตรียม…",
    listening: "กำลังฟัง",
    finishing: "ได้ยินแล้ว",
    translating: "กำลังแปล…",
    fallback: "ระบบเปลี่ยนการรับเสียงให้อัตโนมัติ กรุณาพูดต่อ",
    confirmTranscript: (text) => `“${text}” ถูกต้องไหม?`,
    yes: "ถูกต้อง",
    speakAgain: "พูดอีกครั้ง",
    failure: createFailureCopy({
      permission: "ใช้ไมโครโฟนไม่ได้ กรุณาอนุญาตหรือพิมพ์ข้อความ",
      noSpeech: "ไม่ได้ยินเสียง กรุณาลองใหม่หรือพิมพ์ข้อความ",
      unavailable: "อุปกรณ์นี้ใช้การป้อนเสียงไม่ได้ กรุณาพิมพ์ข้อความ",
      failed: "การป้อนเสียงหยุดลง กรุณาลองใหม่หรือพิมพ์ข้อความ",
    }),
  },
  id: {
    speak: "Bicara",
    connecting: "Menyiapkan…",
    listening: "Mendengarkan",
    finishing: "Sudah terdengar",
    translating: "Menerjemahkan…",
    fallback: "Input suara dialihkan otomatis. Silakan lanjut bicara.",
    confirmTranscript: (text) => `Apakah “${text}” benar?`,
    yes: "Benar",
    speakAgain: "Bicara lagi",
    failure: createFailureCopy({
      permission: "Mikrofon tidak dapat digunakan. Izinkan akses atau ketik pesan.",
      noSpeech: "Tidak ada suara yang terdengar. Coba lagi atau ketik pesan.",
      unavailable: "Input suara tidak tersedia di perangkat ini. Silakan ketik pesan.",
      failed: "Input suara berhenti. Coba lagi atau ketik pesan.",
    }),
  },
  ru: {
    speak: "Говорить",
    connecting: "Подготовка…",
    listening: "Слушаю",
    finishing: "Услышал",
    translating: "Перевод…",
    fallback: "Голосовой ввод переключён автоматически. Продолжайте говорить.",
    confirmTranscript: (text) => `Верно: «${text}»?`,
    yes: "Да",
    speakAgain: "Сказать ещё раз",
    failure: createFailureCopy({
      permission: "Микрофон недоступен. Разрешите доступ или введите текст.",
      noSpeech: "Речь не слышна. Попробуйте ещё раз или введите текст.",
      unavailable: "Голосовой ввод недоступен на этом устройстве. Введите текст.",
      failed: "Голосовой ввод остановлен. Попробуйте снова или введите текст.",
    }),
  },
  ar: {
    speak: "تحدّث",
    connecting: "جارٍ الاستعداد…",
    listening: "أستمع إليك",
    finishing: "تم السماع",
    translating: "جارٍ الترجمة…",
    fallback: "تم تبديل الإدخال الصوتي تلقائياً. تابع التحدث.",
    confirmTranscript: (text) => `هل «${text}» صحيح؟`,
    yes: "نعم",
    speakAgain: "التحدث مرة أخرى",
    failure: createFailureCopy({
      permission: "لا يمكن استخدام الميكروفون. اسمح بالوصول أو اكتب رسالتك.",
      noSpeech: "لم يُسمع شيء. حاول مرة أخرى أو اكتب رسالتك.",
      unavailable: "الإدخال الصوتي غير متاح على هذا الجهاز. اكتب رسالتك.",
      failed: "توقف الإدخال الصوتي. حاول مرة أخرى أو اكتب رسالتك.",
    }),
  },
};

export function voiceStringsFor(language: string): CounterVoiceStrings {
  return COPY[language.split("-")[0].toLowerCase()] ?? EN;
}
