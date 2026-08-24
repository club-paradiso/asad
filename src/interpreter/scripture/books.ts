/**
 * Korean → English Bible book table.
 *
 * Each entry carries every Korean form a preacher (or a speech recogniser) is
 * likely to produce, the canonical English name, and the book's chapter count
 * so that an obviously impossible reference can be rejected instead of shown.
 *
 * `ambiguous: true` marks Korean forms that are also ordinary words — 아가
 * ("baby"), 마 / 요 / 시 as bare syllables. Those only ever match when
 * immediately followed by a chapter number, and they resolve at lower
 * confidence.
 */
export interface BibleBook {
  /** Korean forms, longest-first matching is applied by the detector. */
  ko: string[];
  /** Canonical English book name. */
  en: string;
  /** Number of chapters, used to reject impossible references. */
  chapters: number;
  testament: "old" | "new";
  ambiguous?: boolean;
}

export const BIBLE_BOOKS: BibleBook[] = [
  // --- Old Testament ------------------------------------------------------
  { ko: ["창세기", "창"], en: "Genesis", chapters: 50, testament: "old" },
  { ko: ["출애굽기", "출"], en: "Exodus", chapters: 40, testament: "old" },
  { ko: ["레위기", "레"], en: "Leviticus", chapters: 27, testament: "old" },
  { ko: ["민수기", "민"], en: "Numbers", chapters: 36, testament: "old" },
  { ko: ["신명기", "신"], en: "Deuteronomy", chapters: 34, testament: "old" },
  { ko: ["여호수아", "수"], en: "Joshua", chapters: 24, testament: "old" },
  { ko: ["사사기", "삿"], en: "Judges", chapters: 21, testament: "old" },
  { ko: ["룻기", "룻"], en: "Ruth", chapters: 4, testament: "old" },
  { ko: ["사무엘상", "삼상"], en: "1 Samuel", chapters: 31, testament: "old" },
  { ko: ["사무엘하", "삼하"], en: "2 Samuel", chapters: 24, testament: "old" },
  { ko: ["열왕기상", "왕상"], en: "1 Kings", chapters: 22, testament: "old" },
  { ko: ["열왕기하", "왕하"], en: "2 Kings", chapters: 25, testament: "old" },
  { ko: ["역대상", "대상"], en: "1 Chronicles", chapters: 29, testament: "old" },
  { ko: ["역대하", "대하"], en: "2 Chronicles", chapters: 36, testament: "old" },
  { ko: ["에스라", "스"], en: "Ezra", chapters: 10, testament: "old" },
  { ko: ["느헤미야", "느"], en: "Nehemiah", chapters: 13, testament: "old" },
  { ko: ["에스더", "에"], en: "Esther", chapters: 10, testament: "old" },
  { ko: ["욥기", "욥"], en: "Job", chapters: 42, testament: "old" },
  { ko: ["시편", "시"], en: "Psalms", chapters: 150, testament: "old", ambiguous: true },
  { ko: ["잠언", "잠"], en: "Proverbs", chapters: 31, testament: "old" },
  { ko: ["전도서", "전"], en: "Ecclesiastes", chapters: 12, testament: "old" },
  { ko: ["아가서", "아가", "아"], en: "Song of Songs", chapters: 8, testament: "old", ambiguous: true },
  { ko: ["이사야", "사"], en: "Isaiah", chapters: 66, testament: "old" },
  { ko: ["예레미야애가", "애가", "애"], en: "Lamentations", chapters: 5, testament: "old" },
  { ko: ["예레미야", "렘"], en: "Jeremiah", chapters: 52, testament: "old" },
  { ko: ["에스겔", "겔"], en: "Ezekiel", chapters: 48, testament: "old" },
  { ko: ["다니엘", "단"], en: "Daniel", chapters: 12, testament: "old" },
  { ko: ["호세아", "호"], en: "Hosea", chapters: 14, testament: "old" },
  { ko: ["요엘", "욜"], en: "Joel", chapters: 3, testament: "old" },
  { ko: ["아모스", "암"], en: "Amos", chapters: 9, testament: "old" },
  { ko: ["오바댜", "옵"], en: "Obadiah", chapters: 1, testament: "old" },
  { ko: ["요나", "욘"], en: "Jonah", chapters: 4, testament: "old" },
  { ko: ["미가", "미"], en: "Micah", chapters: 7, testament: "old", ambiguous: true },
  { ko: ["나훔", "나"], en: "Nahum", chapters: 3, testament: "old", ambiguous: true },
  { ko: ["하박국", "합"], en: "Habakkuk", chapters: 3, testament: "old" },
  { ko: ["스바냐", "습"], en: "Zephaniah", chapters: 3, testament: "old" },
  { ko: ["학개", "학"], en: "Haggai", chapters: 2, testament: "old" },
  { ko: ["스가랴", "슥"], en: "Zechariah", chapters: 14, testament: "old" },
  { ko: ["말라기", "말"], en: "Malachi", chapters: 4, testament: "old", ambiguous: true },

  // --- New Testament ------------------------------------------------------
  { ko: ["마태복음", "마"], en: "Matthew", chapters: 28, testament: "new", ambiguous: true },
  { ko: ["마가복음", "막"], en: "Mark", chapters: 16, testament: "new" },
  { ko: ["누가복음", "눅"], en: "Luke", chapters: 24, testament: "new" },
  { ko: ["요한복음", "요"], en: "John", chapters: 21, testament: "new", ambiguous: true },
  { ko: ["사도행전", "행"], en: "Acts", chapters: 28, testament: "new" },
  { ko: ["로마서", "롬"], en: "Romans", chapters: 16, testament: "new" },
  { ko: ["고린도전서", "고전"], en: "1 Corinthians", chapters: 16, testament: "new" },
  { ko: ["고린도후서", "고후"], en: "2 Corinthians", chapters: 13, testament: "new" },
  { ko: ["갈라디아서", "갈"], en: "Galatians", chapters: 6, testament: "new" },
  { ko: ["에베소서", "엡"], en: "Ephesians", chapters: 6, testament: "new" },
  { ko: ["빌립보서", "빌"], en: "Philippians", chapters: 4, testament: "new" },
  { ko: ["골로새서", "골"], en: "Colossians", chapters: 4, testament: "new" },
  { ko: ["데살로니가전서", "살전"], en: "1 Thessalonians", chapters: 5, testament: "new" },
  { ko: ["데살로니가후서", "살후"], en: "2 Thessalonians", chapters: 3, testament: "new" },
  { ko: ["디모데전서", "딤전"], en: "1 Timothy", chapters: 6, testament: "new" },
  { ko: ["디모데후서", "딤후"], en: "2 Timothy", chapters: 4, testament: "new" },
  { ko: ["디도서", "딛"], en: "Titus", chapters: 3, testament: "new" },
  { ko: ["빌레몬서", "몬"], en: "Philemon", chapters: 1, testament: "new" },
  { ko: ["히브리서", "히"], en: "Hebrews", chapters: 13, testament: "new" },
  { ko: ["야고보서", "약"], en: "James", chapters: 5, testament: "new" },
  { ko: ["베드로전서", "벧전"], en: "1 Peter", chapters: 5, testament: "new" },
  { ko: ["베드로후서", "벧후"], en: "2 Peter", chapters: 3, testament: "new" },
  { ko: ["요한일서", "요일"], en: "1 John", chapters: 5, testament: "new" },
  { ko: ["요한이서", "요이"], en: "2 John", chapters: 1, testament: "new" },
  { ko: ["요한삼서", "요삼"], en: "3 John", chapters: 1, testament: "new" },
  { ko: ["유다서", "유"], en: "Jude", chapters: 1, testament: "new", ambiguous: true },
  { ko: ["요한계시록", "계시록", "계"], en: "Revelation", chapters: 22, testament: "new" },
];

interface BookForm {
  form: string;
  book: BibleBook;
  /** True when the Korean form is a bare abbreviation. */
  abbreviated: boolean;
}

/** Every Korean form, longest first so 요한복음 wins over 요. */
export const BOOK_FORMS: BookForm[] = BIBLE_BOOKS.flatMap((book) =>
  book.ko.map((form, index) => ({ form, book, abbreviated: index > 0 })),
).sort((a, b) => b.form.length - a.form.length);

const FORM_INDEX = new Map<string, BookForm>(BOOK_FORMS.map((f) => [f.form, f]));

export const lookupKoreanBook = (form: string): BookForm | undefined =>
  FORM_INDEX.get(form.trim());

/** Canonical English name → book, for validating prep-sheet input. */
const EN_INDEX = new Map<string, BibleBook>(
  BIBLE_BOOKS.map((b) => [b.en.toLowerCase(), b]),
);

export const lookupEnglishBook = (name: string): BibleBook | undefined =>
  EN_INDEX.get(name.trim().toLowerCase());
