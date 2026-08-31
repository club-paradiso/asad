import { findLanguage } from "@/counter/languages";

export interface CounterSessionEndCopy {
  endAction: string;
  endedTitle: string;
  endedDetail: string;
  closing: string;
}

const EN: CounterSessionEndCopy = {
  endAction: "End conversation",
  endedTitle: "Conversation ended",
  endedDetail: "This page will close automatically. If it stays open, you can close it safely.",
  closing: "Closing this conversation…",
};

const COPY: Record<string, CounterSessionEndCopy> = {
  "ko-KR": {
    endAction: "대화 끝내기",
    endedTitle: "대화가 종료되었습니다",
    endedDetail: "이 화면은 자동으로 닫힙니다. 닫히지 않아도 이 페이지를 안전하게 닫으셔도 됩니다.",
    closing: "대화를 종료하는 중입니다…",
  },
  "en-US": EN,
  "zh-CN": {
    endAction: "结束对话",
    endedTitle: "对话已结束",
    endedDetail: "此页面将自动关闭。如果没有关闭，您可以放心关闭此页面。",
    closing: "正在结束对话…",
  },
  "zh-TW": {
    endAction: "結束對話",
    endedTitle: "對話已結束",
    endedDetail: "此頁面將自動關閉。如果沒有關閉，您可以放心關閉此頁面。",
    closing: "正在結束對話…",
  },
  "ja-JP": {
    endAction: "会話を終了",
    endedTitle: "会話が終了しました",
    endedDetail: "この画面は自動的に閉じます。閉じない場合は、このページを閉じて大丈夫です。",
    closing: "会話を終了しています…",
  },
  "vi-VN": {
    endAction: "Kết thúc cuộc trò chuyện",
    endedTitle: "Cuộc trò chuyện đã kết thúc",
    endedDetail: "Trang này sẽ tự đóng. Nếu vẫn mở, bạn có thể đóng trang này an toàn.",
    closing: "Đang kết thúc cuộc trò chuyện…",
  },
  "th-TH": {
    endAction: "จบการสนทนา",
    endedTitle: "การสนทนาสิ้นสุดแล้ว",
    endedDetail: "หน้านี้จะปิดโดยอัตโนมัติ หากยังเปิดอยู่ คุณสามารถปิดหน้านี้ได้อย่างปลอดภัย",
    closing: "กำลังจบการสนทนา…",
  },
  "id-ID": {
    endAction: "Akhiri percakapan",
    endedTitle: "Percakapan telah berakhir",
    endedDetail: "Halaman ini akan tertutup otomatis. Jika tetap terbuka, Anda dapat menutupnya dengan aman.",
    closing: "Mengakhiri percakapan…",
  },
  "ru-RU": {
    endAction: "Завершить разговор",
    endedTitle: "Разговор завершён",
    endedDetail: "Эта страница закроется автоматически. Если она останется открытой, её можно безопасно закрыть.",
    closing: "Завершение разговора…",
  },
  "uz-UZ": {
    endAction: "Suhbatni tugatish",
    endedTitle: "Suhbat tugadi",
    endedDetail: "Bu sahifa avtomatik yopiladi. Ochiq qolsa, uni bemalol yopishingiz mumkin.",
    closing: "Suhbat tugatilmoqda…",
  },
  "mn-MN": {
    endAction: "Яриаг дуусгах",
    endedTitle: "Яриа дууслаа",
    endedDetail: "Энэ хуудас автоматаар хаагдана. Хаагдахгүй бол та аюулгүйгээр хааж болно.",
    closing: "Яриаг дуусгаж байна…",
  },
  "ne-NP": {
    endAction: "कुराकानी समाप्त गर्नुहोस्",
    endedTitle: "कुराकानी समाप्त भयो",
    endedDetail: "यो पृष्ठ आफैं बन्द हुनेछ। खुलै रहेमा, तपाईं यसलाई सुरक्षित रूपमा बन्द गर्न सक्नुहुन्छ।",
    closing: "कुराकानी समाप्त हुँदैछ…",
  },
  "km-KH": {
    endAction: "បញ្ចប់ការសន្ទនា",
    endedTitle: "ការសន្ទនាបានបញ្ចប់",
    endedDetail: "ទំព័រនេះនឹងបិទដោយស្វ័យប្រវត្តិ។ បើនៅតែបើក អ្នកអាចបិទវាបានដោយសុវត្ថិភាព។",
    closing: "កំពុងបញ្ចប់ការសន្ទនា…",
  },
  "my-MM": {
    endAction: "စကားပြောမှုကို အဆုံးသတ်ရန်",
    endedTitle: "စကားပြောမှု ပြီးဆုံးပါပြီ",
    endedDetail: "ဤစာမျက်နှာသည် အလိုအလျောက် ပိတ်ပါမည်။ မပိတ်ပါက လုံခြုံစွာ ပိတ်နိုင်ပါသည်။",
    closing: "စကားပြောမှုကို အဆုံးသတ်နေပါသည်…",
  },
  "tl-PH": {
    endAction: "Tapusin ang usapan",
    endedTitle: "Tapos na ang usapan",
    endedDetail: "Awtomatikong magsasara ang pahinang ito. Kung manatiling bukas, maaari mo itong isara nang ligtas.",
    closing: "Tinatapos ang usapan…",
  },
  "es-ES": {
    endAction: "Finalizar conversación",
    endedTitle: "La conversación ha terminado",
    endedDetail: "Esta página se cerrará automáticamente. Si permanece abierta, puede cerrarla con seguridad.",
    closing: "Finalizando la conversación…",
  },
  "fr-FR": {
    endAction: "Terminer la conversation",
    endedTitle: "La conversation est terminée",
    endedDetail: "Cette page va se fermer automatiquement. Si elle reste ouverte, vous pouvez la fermer sans risque.",
    closing: "Fin de la conversation…",
  },
  "de-DE": {
    endAction: "Gespräch beenden",
    endedTitle: "Das Gespräch ist beendet",
    endedDetail: "Diese Seite wird automatisch geschlossen. Falls sie geöffnet bleibt, können Sie sie sicher schließen.",
    closing: "Gespräch wird beendet…",
  },
  "pt-BR": {
    endAction: "Encerrar conversa",
    endedTitle: "A conversa terminou",
    endedDetail: "Esta página será fechada automaticamente. Se continuar aberta, você pode fechá-la com segurança.",
    closing: "Encerrando a conversa…",
  },
  "ar-SA": {
    endAction: "إنهاء المحادثة",
    endedTitle: "انتهت المحادثة",
    endedDetail: "ستُغلق هذه الصفحة تلقائيًا. إذا بقيت مفتوحة، يمكنك إغلاقها بأمان.",
    closing: "جارٍ إنهاء المحادثة…",
  },
  "hi-IN": {
    endAction: "बातचीत समाप्त करें",
    endedTitle: "बातचीत समाप्त हो गई है",
    endedDetail: "यह पेज अपने-आप बंद हो जाएगा। अगर खुला रहे, तो आप इसे सुरक्षित रूप से बंद कर सकते हैं।",
    closing: "बातचीत समाप्त की जा रही है…",
  },
  "bn-BD": {
    endAction: "কথোপকথন শেষ করুন",
    endedTitle: "কথোপকথন শেষ হয়েছে",
    endedDetail: "এই পৃষ্ঠাটি স্বয়ংক্রিয়ভাবে বন্ধ হবে। খোলা থাকলে আপনি নিরাপদে এটি বন্ধ করতে পারেন।",
    closing: "কথোপকথন শেষ করা হচ্ছে…",
  },
  "ur-PK": {
    endAction: "گفتگو ختم کریں",
    endedTitle: "گفتگو ختم ہو گئی ہے",
    endedDetail: "یہ صفحہ خودکار طور پر بند ہو جائے گا۔ اگر کھلا رہے تو آپ اسے محفوظ طریقے سے بند کر سکتے ہیں۔",
    closing: "گفتگو ختم کی جا رہی ہے…",
  },
  "tr-TR": {
    endAction: "Görüşmeyi bitir",
    endedTitle: "Görüşme sona erdi",
    endedDetail: "Bu sayfa otomatik olarak kapanacaktır. Açık kalırsa güvenle kapatabilirsiniz.",
    closing: "Görüşme bitiriliyor…",
  },
};

export function sessionEndCopy(language: string | null | undefined): CounterSessionEndCopy {
  const normalized = language ? findLanguage(language)?.code : undefined;
  return (normalized && COPY[normalized]) || EN;
}
