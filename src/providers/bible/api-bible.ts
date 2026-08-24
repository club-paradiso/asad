/**
 * scripture.api.bible provider.
 *
 * This is the path for a licensed modern translation. It requires BOTH an API
 * key and a Bible id you are entitled to use — API access is not the same as a
 * distribution licence, and tong-yuck will not pretend otherwise. Configure it
 * only for translations your organisation is permitted to display.
 */
import type { BibleReference } from "@/types";
import { displayReference, type BibleLookup, type BibleProvider, type BibleProviderId } from "./types";
import { lookupEnglishBook } from "@/interpreter/scripture/books";

interface ApiBibleResponse {
  data?: { content?: string; reference?: string };
}

/** api.bible addresses books by USFM code. */
const USFM: Record<string, string> = {
  Genesis: "GEN", Exodus: "EXO", Leviticus: "LEV", Numbers: "NUM", Deuteronomy: "DEU",
  Joshua: "JOS", Judges: "JDG", Ruth: "RUT", "1 Samuel": "1SA", "2 Samuel": "2SA",
  "1 Kings": "1KI", "2 Kings": "2KI", "1 Chronicles": "1CH", "2 Chronicles": "2CH",
  Ezra: "EZR", Nehemiah: "NEH", Esther: "EST", Job: "JOB", Psalms: "PSA",
  Proverbs: "PRO", Ecclesiastes: "ECC", "Song of Songs": "SNG", Isaiah: "ISA",
  Jeremiah: "JER", Lamentations: "LAM", Ezekiel: "EZK", Daniel: "DAN", Hosea: "HOS",
  Joel: "JOL", Amos: "AMO", Obadiah: "OBA", Jonah: "JON", Micah: "MIC", Nahum: "NAM",
  Habakkuk: "HAB", Zephaniah: "ZEP", Haggai: "HAG", Zechariah: "ZEC", Malachi: "MAL",
  Matthew: "MAT", Mark: "MRK", Luke: "LUK", John: "JHN", Acts: "ACT", Romans: "ROM",
  "1 Corinthians": "1CO", "2 Corinthians": "2CO", Galatians: "GAL", Ephesians: "EPH",
  Philippians: "PHP", Colossians: "COL", "1 Thessalonians": "1TH", "2 Thessalonians": "2TH",
  "1 Timothy": "1TI", "2 Timothy": "2TI", Titus: "TIT", Philemon: "PHM", Hebrews: "HEB",
  James: "JAS", "1 Peter": "1PE", "2 Peter": "2PE", "1 John": "1JN", "2 John": "2JN",
  "3 John": "3JN", Jude: "JUD", Revelation: "REV",
};

export class ApiBibleProvider implements BibleProvider {
  readonly id: BibleProviderId = "api-bible";

  constructor(
    private readonly apiKey: string,
    /** The Bible id you hold a licence for. */
    private readonly bibleId: string,
    readonly translations: string[] = [],
  ) {}

  async lookup(reference: BibleLookup, signal?: AbortSignal): Promise<BibleReference> {
    const base: BibleReference = {
      book: reference.book,
      chapter: reference.chapter,
      verse: reference.verse,
      verseEnd: reference.verseEnd,
      display: displayReference(reference),
      confidence: "high",
    };

    const usfm = USFM[reference.book] ?? (lookupEnglishBook(reference.book) ? undefined : undefined);
    if (!usfm || reference.verse === undefined) return base;

    const end = reference.verseEnd && reference.verseEnd > reference.verse ? reference.verseEnd : undefined;
    const passageId = end
      ? `${usfm}.${reference.chapter}.${reference.verse}-${usfm}.${reference.chapter}.${end}`
      : `${usfm}.${reference.chapter}.${reference.verse}`;

    try {
      const url =
        `https://api.scripture.api.bible/v1/bibles/${encodeURIComponent(this.bibleId)}` +
        `/passages/${encodeURIComponent(passageId)}` +
        `?content-type=text&include-notes=false&include-titles=false&include-verse-numbers=false`;

      const response = await fetch(url, { signal, headers: { "api-key": this.apiKey } });
      if (!response.ok) return base;

      const data = (await response.json()) as ApiBibleResponse;
      const text = data.data?.content?.replace(/\s+/g, " ").trim();
      if (!text) return base;

      return { ...base, text, translation: this.translations[0] ?? this.bibleId };
    } catch {
      return base;
    }
  }
}
