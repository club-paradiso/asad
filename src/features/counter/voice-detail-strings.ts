export interface VoiceDetailStrings {
  editTranscript: string;
  reviewLabel: string;
  reviewHint: string;
  stopHint: string;
  stopAria: string;
}

const EN: VoiceDetailStrings = {
  editTranscript: "Edit transcript",
  reviewLabel: "Speech transcript · Editable",
  reviewHint: "Correct names, proper nouns, or recognition errors before sending.",
  stopHint: "When you finish speaking, tap the mic again to stop immediately.",
  stopAria: "Stop voice input",
};

const COPY: Record<string, VoiceDetailStrings> = {
  ko: {
    editTranscript: "직접 수정",
    reviewLabel: "음성 인식 결과 · 수정 가능",
    reviewHint: "이름·고유명사나 잘못 인식된 부분을 바로 고친 뒤 전송하세요.",
    stopHint: "말이 끝났으면 마이크 버튼을 눌러 바로 멈출 수 있어요.",
    stopAria: "음성 입력 중지",
  },
  zh: {
    editTranscript: "手动修改",
    reviewLabel: "语音识别结果 · 可修改",
    reviewHint: "请直接修改姓名、专有名词或识别错误后再发送。",
    stopHint: "说完后，再点一次麦克风即可立即停止。",
    stopAria: "停止语音输入",
  },
  ja: {
    editTranscript: "手動で修正",
    reviewLabel: "音声認識結果 · 編集できます",
    reviewHint: "人名・固有名詞や誤認識された箇所を直してから送信してください。",
    stopHint: "話し終えたら、マイクをもう一度押すとすぐ停止できます。",
    stopAria: "音声入力を停止",
  },
  vi: {
    editTranscript: "Sửa trực tiếp",
    reviewLabel: "Kết quả nhận dạng giọng nói · Có thể sửa",
    reviewHint: "Sửa tên riêng hoặc phần nhận dạng sai trước khi gửi.",
    stopHint: "Nói xong, chạm lại nút mic để dừng ngay.",
    stopAria: "Dừng nhập bằng giọng nói",
  },
  th: {
    editTranscript: "แก้ไขเอง",
    reviewLabel: "ผลการรู้จำเสียง · แก้ไขได้",
    reviewHint: "แก้ชื่อ คำเฉพาะ หรือส่วนที่รู้จำผิดก่อนส่ง",
    stopHint: "พูดจบแล้ว แตะปุ่มไมค์อีกครั้งเพื่อหยุดได้ทันที",
    stopAria: "หยุดการป้อนเสียง",
  },
  id: {
    editTranscript: "Edit langsung",
    reviewLabel: "Hasil pengenalan suara · Bisa diedit",
    reviewHint: "Perbaiki nama, istilah khusus, atau bagian yang salah sebelum mengirim.",
    stopHint: "Setelah selesai bicara, ketuk mikrofon lagi untuk berhenti.",
    stopAria: "Hentikan input suara",
  },
  ru: {
    editTranscript: "Исправить вручную",
    reviewLabel: "Результат распознавания · Можно исправить",
    reviewHint: "Исправьте имена, термины и ошибки распознавания перед отправкой.",
    stopHint: "Закончив говорить, нажмите микрофон ещё раз, чтобы остановить запись.",
    stopAria: "Остановить голосовой ввод",
  },
  uz: {
    editTranscript: "Qoʻlda tahrirlash",
    reviewLabel: "Ovoz tanish natijasi · Tahrirlash mumkin",
    reviewHint: "Yuborishdan oldin ism, atama yoki notoʻgʻri tanilgan qismlarni tuzating.",
    stopHint: "Gap tugagach, toʻxtatish uchun mikrofonni yana bosing.",
    stopAria: "Ovozli kiritishni toʻxtatish",
  },
  mn: {
    editTranscript: "Гараар засах",
    reviewLabel: "Дуу танилтын үр дүн · Засаж болно",
    reviewHint: "Илгээхийн өмнө нэр, тусгай нэр томьёо болон буруу таньсан хэсгийг засаарай.",
    stopHint: "Ярьж дуусмагц микрофоныг дахин дарж шууд зогсооно уу.",
    stopAria: "Дуу хоолойн оролтыг зогсоох",
  },
  ne: {
    editTranscript: "आफैं सच्याउनुहोस्",
    reviewLabel: "आवाज पहिचान परिणाम · सच्याउन सकिन्छ",
    reviewHint: "पठाउनु अघि नाम, विशेष शब्द वा गलत पहिचान भएको भाग सच्याउनुहोस्।",
    stopHint: "बोलिसकेपछि तुरुन्त रोक्न माइक्रोफोन फेरि थिच्नुहोस्।",
    stopAria: "आवाज इनपुट रोक्नुहोस्",
  },
  km: {
    editTranscript: "កែដោយផ្ទាល់",
    reviewLabel: "លទ្ធផលស្គាល់សំឡេង · អាចកែបាន",
    reviewHint: "សូមកែឈ្មោះ ពាក្យពិសេស ឬផ្នែកដែលស្គាល់ខុស មុនពេលផ្ញើ។",
    stopHint: "ពេលនិយាយចប់ សូមចុចមីក្រូហ្វូនម្តងទៀតដើម្បីបញ្ឈប់ភ្លាមៗ។",
    stopAria: "បញ្ឈប់ការបញ្ចូលសំឡេង",
  },
  my: {
    editTranscript: "ကိုယ်တိုင်ပြင်ရန်",
    reviewLabel: "အသံမှတ်သားမှု ရလဒ် · ပြင်နိုင်သည်",
    reviewHint: "မပို့မီ အမည်၊ သီးသန့်စကားလုံး သို့မဟုတ် မှားယွင်းမှတ်သားထားသည့် အပိုင်းကို ပြင်ပါ။",
    stopHint: "ပြောပြီးပါက မိုက်ခရိုဖုန်းကို ထပ်နှိပ်ပြီး ချက်ချင်းရပ်နိုင်သည်။",
    stopAria: "အသံထည့်သွင်းမှု ရပ်ရန်",
  },
  tl: {
    editTranscript: "Manu-manong ayusin",
    reviewLabel: "Resulta ng voice recognition · Maaaring i-edit",
    reviewHint: "Ayusin ang mga pangalan, espesyal na termino, o maling pagkilala bago ipadala.",
    stopHint: "Kapag tapos ka nang magsalita, i-tap ulit ang mic para huminto agad.",
    stopAria: "Ihinto ang voice input",
  },
  es: {
    editTranscript: "Editar manualmente",
    reviewLabel: "Transcripción de voz · Editable",
    reviewHint: "Corrija nombres, términos propios o errores de reconocimiento antes de enviar.",
    stopHint: "Cuando termine de hablar, pulse de nuevo el micrófono para detenerlo.",
    stopAria: "Detener entrada por voz",
  },
  fr: {
    editTranscript: "Modifier manuellement",
    reviewLabel: "Transcription vocale · Modifiable",
    reviewHint: "Corrigez les noms, termes propres ou erreurs de reconnaissance avant l’envoi.",
    stopHint: "Quand vous avez fini de parler, touchez de nouveau le micro pour arrêter.",
    stopAria: "Arrêter la saisie vocale",
  },
  de: {
    editTranscript: "Manuell bearbeiten",
    reviewLabel: "Spracherkennung · Bearbeitbar",
    reviewHint: "Korrigiere Namen, Eigennamen oder Erkennungsfehler vor dem Senden.",
    stopHint: "Wenn du fertig gesprochen hast, tippe erneut auf das Mikrofon, um zu stoppen.",
    stopAria: "Spracheingabe stoppen",
  },
  pt: {
    editTranscript: "Editar manualmente",
    reviewLabel: "Transcrição de voz · Editável",
    reviewHint: "Corrija nomes, termos próprios ou erros de reconhecimento antes de enviar.",
    stopHint: "Quando terminar de falar, toque novamente no microfone para parar.",
    stopAria: "Parar entrada por voz",
  },
  ar: {
    editTranscript: "تعديل يدوي",
    reviewLabel: "نتيجة التعرّف على الصوت · قابلة للتعديل",
    reviewHint: "صحّح الأسماء والمصطلحات وأخطاء التعرّف قبل الإرسال.",
    stopHint: "بعد الانتهاء من الكلام، اضغط زر الميكروفون مرة أخرى للإيقاف.",
    stopAria: "إيقاف الإدخال الصوتي",
  },
  hi: {
    editTranscript: "खुद संपादित करें",
    reviewLabel: "वॉइस पहचान परिणाम · संपादन योग्य",
    reviewHint: "भेजने से पहले नाम, विशेष शब्द या पहचान की गलतियाँ सुधारें।",
    stopHint: "बोलना पूरा होने पर रोकने के लिए माइक्रोफ़ोन फिर से दबाएँ।",
    stopAria: "वॉइस इनपुट रोकें",
  },
  bn: {
    editTranscript: "নিজে সম্পাদনা করুন",
    reviewLabel: "ভয়েস শনাক্তকরণের ফল · সম্পাদনাযোগ্য",
    reviewHint: "পাঠানোর আগে নাম, বিশেষ শব্দ বা শনাক্তকরণের ভুল ঠিক করুন।",
    stopHint: "কথা শেষ হলে থামাতে আবার মাইক্রোফোনে চাপুন।",
    stopAria: "ভয়েস ইনপুট বন্ধ করুন",
  },
  ur: {
    editTranscript: "خود ترمیم کریں",
    reviewLabel: "آواز کی شناخت کا نتیجہ · قابلِ ترمیم",
    reviewHint: "بھیجنے سے پہلے نام، خاص اصطلاحات یا شناخت کی غلطیاں درست کریں۔",
    stopHint: "بات مکمل ہونے پر روکنے کے لیے مائیکروفون دوبارہ دبائیں۔",
    stopAria: "وائس اِن پٹ روکیں",
  },
  tr: {
    editTranscript: "Elle düzenle",
    reviewLabel: "Ses tanıma sonucu · Düzenlenebilir",
    reviewHint: "Göndermeden önce adları, özel terimleri veya tanıma hatalarını düzeltin.",
    stopHint: "Konuşmanız bittiğinde durdurmak için mikrofona tekrar dokunun.",
    stopAria: "Sesli girişi durdur",
  },
};

export function voiceDetailStringsFor(language: string): VoiceDetailStrings {
  return COPY[language.split("-")[0].toLowerCase()] ?? EN;
}
