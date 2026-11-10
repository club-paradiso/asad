/**
 * Strings for the correction and verification-state affordances.
 *
 * Visitor-facing strings exist for the registry's priority languages and fall
 * back to English. Staff-facing strings are Korean or English by the staff
 * member's language, matching the existing staff review block.
 */

export interface CorrectionStrings {
  /** Button on one's own message. */
  correct: string;
  /** Label on the corrected (new) message. */
  correctedVersion: string;
  /** Label on a message that was later corrected. */
  replaced: string;
  send: string;
  cancel: string;
  /** Label on a staff message that asks a clarification question. */
  clarifying: string;
}

const EN: CorrectionStrings = {
  correct: "Correct",
  correctedVersion: "Corrected version",
  replaced: "Corrected below",
  send: "Send correction",
  cancel: "Cancel",
  clarifying: "Clarifying question",
};

const STRINGS: Record<string, CorrectionStrings> = {
  en: EN,
  ko: {
    correct: "고치기",
    correctedVersion: "고친 내용",
    replaced: "아래에서 고쳐 다시 보냄",
    send: "고친 내용 보내기",
    cancel: "취소",
    clarifying: "확인 질문",
  },
  zh: {
    correct: "更正",
    correctedVersion: "更正后的内容",
    replaced: "已在下方更正",
    send: "发送更正",
    cancel: "取消",
    clarifying: "确认问题",
  },
  vi: {
    correct: "Sửa",
    correctedVersion: "Nội dung đã sửa",
    replaced: "Đã sửa ở bên dưới",
    send: "Gửi bản sửa",
    cancel: "Hủy",
    clarifying: "Câu hỏi xác nhận",
  },
  id: {
    correct: "Perbaiki",
    correctedVersion: "Versi yang diperbaiki",
    replaced: "Diperbaiki di bawah",
    send: "Kirim perbaikan",
    cancel: "Batal",
    clarifying: "Pertanyaan konfirmasi",
  },
  ru: {
    correct: "Исправить",
    correctedVersion: "Исправленный вариант",
    replaced: "Исправлено ниже",
    send: "Отправить исправление",
    cancel: "Отмена",
    clarifying: "Уточняющий вопрос",
  },
  th: {
    correct: "แก้ไข",
    correctedVersion: "ข้อความที่แก้ไขแล้ว",
    replaced: "แก้ไขแล้วด้านล่าง",
    send: "ส่งข้อความที่แก้ไข",
    cancel: "ยกเลิก",
    clarifying: "คำถามเพื่อยืนยัน",
  },
  ja: {
    correct: "訂正",
    correctedVersion: "訂正した内容",
    replaced: "下で訂正済み",
    send: "訂正を送信",
    cancel: "キャンセル",
    clarifying: "確認の質問",
  },
};

export function correctionStringsFor(lang: string): CorrectionStrings {
  return STRINGS[lang.split("-")[0].toLowerCase()] ?? EN;
}
