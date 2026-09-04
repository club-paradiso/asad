export interface VoiceReadinessStrings {
  prepare: string;
  preparing: string;
  ready: string;
  hint: string;
  denied: string;
  unavailable: string;
}

const EN: VoiceReadinessStrings = {
  prepare: "Prepare voice input",
  preparing: "Requesting microphone…",
  ready: "Voice input ready",
  hint: "Optional. Allow the microphone now so you can speak immediately later.",
  denied: "Microphone access is blocked. Text input will still work.",
  unavailable: "Voice input is not available on this device. Text input will still work.",
};

const COPY: Record<string, VoiceReadinessStrings> = {
  ko: {
    prepare: "음성 입력 준비",
    preparing: "마이크 권한 확인 중…",
    ready: "음성 입력 준비 완료",
    hint: "선택 사항입니다. 지금 마이크를 허용하면 나중에 바로 말할 수 있어요.",
    denied: "마이크 권한이 차단되어 있어요. 텍스트 입력은 그대로 사용할 수 있습니다.",
    unavailable: "이 기기에서는 음성 입력을 사용할 수 없어요. 텍스트 입력은 그대로 사용할 수 있습니다.",
  },
  zh: {
    prepare: "准备语音输入",
    preparing: "正在请求麦克风权限…",
    ready: "语音输入已准备好",
    hint: "可选。现在允许麦克风，之后即可立即开始说话。",
    denied: "麦克风权限已被阻止。仍可使用文字输入。",
    unavailable: "此设备无法使用语音输入。仍可使用文字输入。",
  },
  ja: {
    prepare: "音声入力を準備",
    preparing: "マイクの許可を確認中…",
    ready: "音声入力の準備完了",
    hint: "任意です。今マイクを許可すると、あとですぐ話し始められます。",
    denied: "マイクへのアクセスがブロックされています。文字入力は引き続き使えます。",
    unavailable: "この端末では音声入力を利用できません。文字入力は引き続き使えます。",
  },
  vi: {
    prepare: "Chuẩn bị nhập bằng giọng nói",
    preparing: "Đang xin quyền dùng micrô…",
    ready: "Đã sẵn sàng nhập bằng giọng nói",
    hint: "Không bắt buộc. Cho phép micrô ngay để lát nữa có thể nói ngay lập tức.",
    denied: "Quyền dùng micrô đang bị chặn. Bạn vẫn có thể nhập bằng bàn phím.",
    unavailable: "Thiết bị này không hỗ trợ nhập bằng giọng nói. Bạn vẫn có thể nhập bằng bàn phím.",
  },
  th: {
    prepare: "เตรียมการป้อนเสียง",
    preparing: "กำลังขออนุญาตใช้ไมโครโฟน…",
    ready: "พร้อมใช้งานการป้อนเสียง",
    hint: "ไม่บังคับ อนุญาตไมโครโฟนตอนนี้เพื่อให้พูดได้ทันทีในภายหลัง",
    denied: "การเข้าถึงไมโครโฟนถูกบล็อก แต่ยังพิมพ์ข้อความได้ตามปกติ",
    unavailable: "อุปกรณ์นี้ไม่รองรับการป้อนเสียง แต่ยังพิมพ์ข้อความได้ตามปกติ",
  },
  id: {
    prepare: "Siapkan input suara",
    preparing: "Meminta izin mikrofon…",
    ready: "Input suara siap",
    hint: "Opsional. Izinkan mikrofon sekarang agar nanti Anda bisa langsung berbicara.",
    denied: "Akses mikrofon diblokir. Input teks tetap dapat digunakan.",
    unavailable: "Input suara tidak tersedia di perangkat ini. Input teks tetap dapat digunakan.",
  },
  ru: {
    prepare: "Подготовить голосовой ввод",
    preparing: "Запрашиваем доступ к микрофону…",
    ready: "Голосовой ввод готов",
    hint: "Необязательно. Разрешите микрофон сейчас, чтобы потом можно было сразу говорить.",
    denied: "Доступ к микрофону заблокирован. Текстовый ввод продолжит работать.",
    unavailable: "Голосовой ввод недоступен на этом устройстве. Текстовый ввод продолжит работать.",
  },
  uz: {
    prepare: "Ovozli kiritishni tayyorlash",
    preparing: "Mikrofon ruxsati soʻralmoqda…",
    ready: "Ovozli kiritish tayyor",
    hint: "Ixtiyoriy. Hozir mikrofonni ruxsat qilsangiz, keyin darhol gapira olasiz.",
    denied: "Mikrofonga ruxsat bloklangan. Matn kiritish ishlashda davom etadi.",
    unavailable: "Bu qurilmada ovozli kiritish mavjud emas. Matn kiritish ishlashda davom etadi.",
  },
  mn: {
    prepare: "Дуу хоолойн оролтыг бэлтгэх",
    preparing: "Микрофоны зөвшөөрөл хүсэж байна…",
    ready: "Дуу хоолойн оролт бэлэн",
    hint: "Заавал биш. Одоо микрофоныг зөвшөөрвөл дараа нь шууд ярьж болно.",
    denied: "Микрофоны хандалт хаалттай байна. Текстээр оруулах боломж хэвээр байна.",
    unavailable: "Энэ төхөөрөмж дээр дуу хоолойн оролт ашиглах боломжгүй. Текстээр оруулах боломж хэвээр байна.",
  },
  ne: {
    prepare: "आवाज इनपुट तयार गर्नुहोस्",
    preparing: "माइक्रोफोन अनुमति मागिँदैछ…",
    ready: "आवाज इनपुट तयार छ",
    hint: "ऐच्छिक। अहिले माइक्रोफोन अनुमति दिनुहोस् ताकि पछि तुरुन्त बोल्न सक्नुहोस्।",
    denied: "माइक्रोफोन पहुँच रोकिएको छ। पाठ इनपुट भने प्रयोग गर्न सकिन्छ।",
    unavailable: "यो उपकरणमा आवाज इनपुट उपलब्ध छैन। पाठ इनपुट भने प्रयोग गर्न सकिन्छ।",
  },
  km: {
    prepare: "រៀបចំបញ្ចូលសំឡេង",
    preparing: "កំពុងស្នើសុំសិទ្ធិមីក្រូហ្វូន…",
    ready: "ការបញ្ចូលសំឡេងរួចរាល់",
    hint: "ជាជម្រើស។ អនុញ្ញាតមីក្រូហ្វូនឥឡូវនេះ ដើម្បីអាចនិយាយភ្លាមៗនៅពេលក្រោយ។",
    denied: "សិទ្ធិប្រើមីក្រូហ្វូនត្រូវបានរារាំង។ អ្នកនៅតែអាចវាយអត្ថបទបាន។",
    unavailable: "ឧបករណ៍នេះមិនអាចប្រើការបញ្ចូលសំឡេងបានទេ។ អ្នកនៅតែអាចវាយអត្ថបទបាន។",
  },
  my: {
    prepare: "အသံထည့်သွင်းမှု ပြင်ဆင်ရန်",
    preparing: "မိုက်ခရိုဖုန်း ခွင့်ပြုချက် တောင်းနေသည်…",
    ready: "အသံထည့်သွင်းမှု အဆင်သင့်ဖြစ်ပြီ",
    hint: "ရွေးချယ်နိုင်သည်။ ယခု မိုက်ခရိုဖုန်းကို ခွင့်ပြုထားပါက နောက်မှ ချက်ချင်း ပြောနိုင်သည်။",
    denied: "မိုက်ခရိုဖုန်း အသုံးပြုခွင့် ပိတ်ထားသည်။ စာရိုက်ထည့်သွင်းမှုကို ဆက်သုံးနိုင်သည်။",
    unavailable: "ဤစက်တွင် အသံထည့်သွင်းမှု မရနိုင်ပါ။ စာရိုက်ထည့်သွင်းမှုကို ဆက်သုံးနိုင်သည်။",
  },
  tl: {
    prepare: "Ihanda ang voice input",
    preparing: "Humihingi ng pahintulot sa mikropono…",
    ready: "Handa na ang voice input",
    hint: "Opsyonal. Payagan ang mikropono ngayon para makapagsalita ka agad mamaya.",
    denied: "Naka-block ang access sa mikropono. Magagamit pa rin ang text input.",
    unavailable: "Hindi available ang voice input sa device na ito. Magagamit pa rin ang text input.",
  },
  es: {
    prepare: "Preparar entrada por voz",
    preparing: "Solicitando permiso para el micrófono…",
    ready: "Entrada por voz lista",
    hint: "Opcional. Permita el micrófono ahora para poder hablar inmediatamente después.",
    denied: "El acceso al micrófono está bloqueado. La entrada de texto seguirá funcionando.",
    unavailable: "La entrada por voz no está disponible en este dispositivo. La entrada de texto seguirá funcionando.",
  },
  fr: {
    prepare: "Préparer la saisie vocale",
    preparing: "Demande d’accès au micro…",
    ready: "Saisie vocale prête",
    hint: "Facultatif. Autorisez le micro maintenant pour pouvoir parler immédiatement ensuite.",
    denied: "L’accès au micro est bloqué. La saisie au clavier reste disponible.",
    unavailable: "La saisie vocale n’est pas disponible sur cet appareil. La saisie au clavier reste disponible.",
  },
  de: {
    prepare: "Spracheingabe vorbereiten",
    preparing: "Mikrofonberechtigung wird angefragt…",
    ready: "Spracheingabe bereit",
    hint: "Optional. Erlaube das Mikrofon jetzt, damit du später sofort sprechen kannst.",
    denied: "Der Mikrofonzugriff ist blockiert. Texteingabe funktioniert weiterhin.",
    unavailable: "Spracheingabe ist auf diesem Gerät nicht verfügbar. Texteingabe funktioniert weiterhin.",
  },
  pt: {
    prepare: "Preparar entrada por voz",
    preparing: "Solicitando permissão do microfone…",
    ready: "Entrada por voz pronta",
    hint: "Opcional. Permita o microfone agora para poder falar imediatamente depois.",
    denied: "O acesso ao microfone está bloqueado. A entrada de texto continuará funcionando.",
    unavailable: "A entrada por voz não está disponível neste dispositivo. A entrada de texto continuará funcionando.",
  },
  ar: {
    prepare: "تهيئة الإدخال الصوتي",
    preparing: "جارٍ طلب إذن الميكروفون…",
    ready: "الإدخال الصوتي جاهز",
    hint: "اختياري. اسمح بالميكروفون الآن لتتمكن من التحدث فوراً لاحقاً.",
    denied: "الوصول إلى الميكروفون محظور. سيظل إدخال النص متاحاً.",
    unavailable: "الإدخال الصوتي غير متاح على هذا الجهاز. سيظل إدخال النص متاحاً.",
  },
  hi: {
    prepare: "वॉइस इनपुट तैयार करें",
    preparing: "माइक्रोफ़ोन की अनुमति मांगी जा रही है…",
    ready: "वॉइस इनपुट तैयार है",
    hint: "वैकल्पिक। अभी माइक्रोफ़ोन की अनुमति दें ताकि बाद में तुरंत बोल सकें।",
    denied: "माइक्रोफ़ोन की अनुमति बंद है। टेक्स्ट इनपुट फिर भी काम करेगा।",
    unavailable: "इस डिवाइस पर वॉइस इनपुट उपलब्ध नहीं है। टेक्स्ट इनपुट फिर भी काम करेगा।",
  },
  bn: {
    prepare: "ভয়েস ইনপুট প্রস্তুত করুন",
    preparing: "মাইক্রোফোনের অনুমতি চাওয়া হচ্ছে…",
    ready: "ভয়েস ইনপুট প্রস্তুত",
    hint: "ঐচ্ছিক। এখন মাইক্রোফোনের অনুমতি দিলে পরে সঙ্গে সঙ্গে কথা বলতে পারবেন।",
    denied: "মাইক্রোফোনের অনুমতি বন্ধ আছে। টেক্সট ইনপুট তবুও ব্যবহার করা যাবে।",
    unavailable: "এই ডিভাইসে ভয়েস ইনপুট পাওয়া যাচ্ছে না। টেক্সট ইনপুট তবুও ব্যবহার করা যাবে।",
  },
  ur: {
    prepare: "وائس اِن پٹ تیار کریں",
    preparing: "مائیکروفون کی اجازت مانگی جا رہی ہے…",
    ready: "وائس اِن پٹ تیار ہے",
    hint: "اختیاری۔ ابھی مائیکروفون کی اجازت دیں تاکہ بعد میں فوراً بول سکیں۔",
    denied: "مائیکروفون کی رسائی بند ہے۔ ٹیکسٹ اِن پٹ پھر بھی کام کرے گا۔",
    unavailable: "اس ڈیوائس پر وائس اِن پٹ دستیاب نہیں۔ ٹیکسٹ اِن پٹ پھر بھی کام کرے گا۔",
  },
  tr: {
    prepare: "Sesli girişi hazırla",
    preparing: "Mikrofon izni isteniyor…",
    ready: "Sesli giriş hazır",
    hint: "İsteğe bağlı. Daha sonra hemen konuşabilmek için mikrofona şimdi izin verin.",
    denied: "Mikrofon erişimi engellenmiş. Metin girişi kullanılmaya devam edebilir.",
    unavailable: "Bu cihazda sesli giriş kullanılamıyor. Metin girişi kullanılmaya devam edebilir.",
  },
};

export function voiceReadinessStringsFor(language: string): VoiceReadinessStrings {
  return COPY[language.split("-")[0].toLowerCase()] ?? EN;
}
