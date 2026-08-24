/**
 * Cultural, idiomatic and wordplay reference data.
 *
 * Literal translation is where Korean humour and cultural meaning go to die.
 * These tables give the interpreter a ready-to-say adaptation plus one line of
 * why — never a paragraph of explanation they have no time to read.
 */
import type { CulturalNote } from "@/types";

export interface IdiomEntry {
  korean: string;
  /** What it actually means. */
  note: string;
  /** Something the interpreter can say immediately. */
  suggestion: string;
  kind: CulturalNote["kind"];
}

export const IDIOMS: IdiomEntry[] = [
  { korean: "콩 심은 데 콩 나고", kind: "idiom", note: "Sowing-and-reaping proverb — lands naturally in a sermon", suggestion: "You reap what you sow." },
  { korean: "티끌 모아 태산", kind: "idiom", note: "Tiny things accumulate into something huge", suggestion: "Little by little, it adds up." },
  { korean: "시작이 반이다", kind: "idiom", note: "Starting is the hard half", suggestion: "Getting started is half the battle." },
  { korean: "고생 끝에 낙이 온다", kind: "idiom", note: "Joy follows hardship", suggestion: "After the hardship comes the joy." },
  { korean: "하늘의 별 따기", kind: "idiom", note: "Effectively impossible", suggestion: "That's like reaching for the stars." },
  { korean: "식은 죽 먹기", kind: "idiom", note: "Trivially easy", suggestion: "It's a piece of cake." },
  { korean: "그림의 떡", kind: "idiom", note: "Visible but unattainable", suggestion: "It's pie in the sky." },
  { korean: "우물 안 개구리", kind: "idiom", note: "Someone who cannot see past their own small world", suggestion: "A frog in a well — you only see your own little sky." },
  { korean: "발 벗고 나서다", kind: "idiom", note: "To throw yourself into helping", suggestion: "To roll up your sleeves and get involved." },
  { korean: "눈코 뜰 새 없이", kind: "idiom", note: "Completely swamped", suggestion: "Run off your feet." },
  { korean: "소 잃고 외양간 고친다", kind: "idiom", note: "Fixing it after the damage is done", suggestion: "Shutting the barn door after the horse is gone." },
  { korean: "백지장도 맞들면 낫다", kind: "idiom", note: "Even a light job is easier shared", suggestion: "Many hands make light work." },
  { korean: "가는 말이 고와야 오는 말이 곱다", kind: "idiom", note: "Kindness is returned in kind", suggestion: "Kind words come back to you." },
  { korean: "원숭이도 나무에서 떨어진다", kind: "idiom", note: "Even experts fail sometimes", suggestion: "Even the best of us slip." },
];

/**
 * Concepts with no clean English equivalent. The interpreter usually keeps the
 * Korean word and adds three words of gloss — this table supplies the gloss.
 */
export const UNTRANSLATABLES: IdiomEntry[] = [
  { korean: "은혜 많이 받으세요", kind: "cultural", note: "A blessing, not a request to 'receive grace'", suggestion: "I hope you're richly blessed today." },
  { korean: "수고하셨습니다", kind: "cultural", note: "Acknowledges effort — no literal English equivalent", suggestion: "Thank you for all your hard work." },
  { korean: "고생하셨습니다", kind: "cultural", note: "Same register, slightly warmer", suggestion: "Thank you — that was hard work." },
  { korean: "화이팅", kind: "cultural", note: "Encouragement, from English 'fighting'", suggestion: "You can do it!" },
  { korean: "눈치", kind: "cultural", note: "Reading the room; social radar", suggestion: "Sensing what the room needs." },
  { korean: "정이 많은", kind: "cultural", note: "정 is deep, accumulated attachment — not just 'affection'", suggestion: "Someone with a lot of warmth toward people." },
  // 한 is never matched bare: it is also the adjectival ending (거룩한), the
  // determiner "one", and a dozen other things. Only real collocations match.
  { korean: "한이 맺힌", kind: "cultural", note: "한 — deep, long-held collective sorrow", suggestion: "Carrying that deep, long-held sorrow." },
  { korean: "한을 품고", kind: "cultural", note: "한 — deep, long-held collective sorrow", suggestion: "Holding on to that deep sorrow." },
  { korean: "효도", kind: "cultural", note: "Filial devotion as a duty, stronger than 'being a good child'", suggestion: "Honouring your parents." },
  { korean: "밥 먹었어요", kind: "cultural", note: "A greeting, not a question about food", suggestion: "How are you doing?" },
  { korean: "추석", kind: "cultural", note: "Autumn harvest holiday, family-focused", suggestion: "Chuseok — the Korean harvest holiday." },
  { korean: "설날", kind: "cultural", note: "Lunar New Year", suggestion: "Korean New Year." },
  { korean: "수능", kind: "cultural", note: "The national university entrance exam — enormous cultural weight", suggestion: "The national college entrance exam." },
  { korean: "새벽기도", kind: "cultural", note: "Daily dawn prayer meeting — a Korean church institution", suggestion: "Early morning prayer." },
];

/**
 * Meanings of syllables that commonly appear in Korean given names. Used to
 * spot the "my name literally means X" move that preachers love.
 */
export const NAME_SYLLABLE_MEANINGS: Record<string, string> = {
  길: "way / road",
  석: "stone",
  호: "great / tiger",
  민: "the people",
  현: "wise / bright",
  정: "upright / true",
  은: "grace / kindness",
  지: "wisdom",
  성: "to become / holy",
  수: "excellent",
  진: "truth / precious",
  철: "iron / clarity",
  경: "reverence",
  광: "light",
  명: "bright",
  선: "goodness",
  영: "eternal / glory",
  용: "courage / dragon",
  하: "summer / great",
  주: "lord / pillar",
  복: "blessing",
  희: "joy",
  빛: "light",
  하늘: "heaven / sky",
  바다: "sea",
  사랑: "love",
  소망: "hope",
  믿음: "faith",
  은혜: "grace",
  새벽: "dawn",
  샘: "spring / fountain",
};

/**
 * Nouns that are also common name syllables. A pun needs the *word* to appear
 * in the discourse, not just the syllable inside the name.
 */
export const PUNNABLE_NOUNS: Record<string, string> = {
  길: "way / road",
  빛: "light",
  하늘: "heaven / sky",
  바다: "sea",
  사랑: "love",
  소망: "hope",
  믿음: "faith",
  은혜: "grace",
  새벽: "dawn",
  샘: "spring / fountain",
  돌: "stone",
  별: "star",
  꽃: "flower",
  나무: "tree",
  물: "water",
  산: "mountain",
  해: "sun",
  달: "moon",
  바람: "wind",
};
