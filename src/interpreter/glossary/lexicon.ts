/**
 * Korean → English lexicons.
 *
 * These are *interpreter aids*, not a substitution table. Nothing here is ever
 * applied by string replacement — the matcher surfaces candidates for the
 * human to use, and the model receives them as context, never as an order.
 *
 * Where a term is genuinely context-dependent (대속, 은혜 in a greeting), the
 * note says so and `alternatives` carries the other reading.
 */
import type { GlossaryItem } from "@/types";

/** Core theological vocabulary — active in SERMON mode. */
export const THEOLOGICAL_LEXICON: GlossaryItem[] = [
  { korean: "은혜", english: "grace", note: "In a greeting/blessing, prefer 'blessing'", alternatives: ["blessing", "favour"], source: "lexicon" },
  { korean: "구원", english: "salvation", alternatives: ["being saved"], source: "lexicon" },
  { korean: "칭의", english: "justification", note: "Technical term — keep precise", source: "lexicon" },
  { korean: "성화", english: "sanctification", note: "Technical term — keep precise", source: "lexicon" },
  { korean: "회개", english: "repentance", alternatives: ["turning back to God"], source: "lexicon" },
  { korean: "부르심", english: "calling", alternatives: ["the call of God"], source: "lexicon" },
  { korean: "언약", english: "covenant", source: "lexicon" },
  { korean: "성령", english: "the Holy Spirit", source: "lexicon" },
  { korean: "성부", english: "the Father", source: "lexicon" },
  { korean: "성자", english: "the Son", source: "lexicon" },
  { korean: "삼위일체", english: "the Trinity", source: "lexicon" },
  { korean: "대속", english: "atonement", note: "Use 'substitutionary atonement' when the substitution is the point", alternatives: ["substitutionary atonement", "redemption"], source: "lexicon" },
  { korean: "속죄", english: "atonement", alternatives: ["expiation"], source: "lexicon" },
  { korean: "십자가", english: "the cross", source: "lexicon" },
  { korean: "부활", english: "the resurrection", source: "lexicon" },
  { korean: "복음", english: "the gospel", alternatives: ["the good news"], source: "lexicon" },
  { korean: "믿음", english: "faith", alternatives: ["belief", "trust"], source: "lexicon" },
  { korean: "소망", english: "hope", source: "lexicon" },
  { korean: "사랑", english: "love", source: "lexicon" },
  { korean: "긍휼", english: "compassion", alternatives: ["mercy"], source: "lexicon" },
  { korean: "자비", english: "mercy", source: "lexicon" },
  { korean: "거룩", english: "holiness", alternatives: ["holy"], source: "lexicon" },
  { korean: "경건", english: "godliness", alternatives: ["reverence"], source: "lexicon" },
  { korean: "예배", english: "worship", alternatives: ["the service"], note: "'예배 시간' is usually 'the service', not 'worship time'", source: "lexicon" },
  { korean: "찬양", english: "praise", alternatives: ["worship music"], source: "lexicon" },
  { korean: "기도", english: "prayer", source: "lexicon" },
  { korean: "중보기도", english: "intercessory prayer", source: "lexicon" },
  { korean: "간증", english: "testimony", source: "lexicon" },
  { korean: "말씀", english: "the Word", note: "'오늘의 말씀' → 'today's passage/text'", alternatives: ["the passage", "the text", "Scripture"], source: "lexicon" },
  { korean: "성경", english: "the Bible", alternatives: ["Scripture"], source: "lexicon" },
  { korean: "제자", english: "disciple", source: "lexicon" },
  { korean: "제자훈련", english: "discipleship training", source: "lexicon" },
  { korean: "전도", english: "evangelism", alternatives: ["sharing the gospel"], source: "lexicon" },
  { korean: "선교", english: "missions", source: "lexicon" },
  { korean: "축복", english: "blessing", source: "lexicon" },
  { korean: "축도", english: "the benediction", source: "lexicon" },
  { korean: "성찬", english: "Communion", alternatives: ["the Lord's Supper"], source: "lexicon" },
  { korean: "세례", english: "baptism", source: "lexicon" },
  { korean: "교제", english: "fellowship", source: "lexicon" },
  { korean: "성도", english: "believers", note: "Addressed to a congregation, 'believers' or 'brothers and sisters' beats 'saints'", alternatives: ["brothers and sisters", "the congregation"], source: "lexicon" },
  { korean: "교회", english: "the church", source: "lexicon" },
  { korean: "목사님", english: "the pastor", note: "Honorific — often just the person's name plus 'Pastor'", source: "lexicon" },
  { korean: "목사", english: "pastor", note: "As a title: 'Pastor' + name", source: "lexicon" },
  { korean: "장로님", english: "the elder", source: "lexicon" },
  { korean: "장로", english: "elder", source: "lexicon" },
  { korean: "집사님", english: "the deacon", source: "lexicon" },
  { korean: "집사", english: "deacon", source: "lexicon" },
  { korean: "권사님", english: "the senior deaconess", note: "No clean English equivalent — 'a senior woman leader in the church'", source: "lexicon" },
  { korean: "전도사님", english: "the assistant pastor", alternatives: ["the evangelist"], source: "lexicon" },
  { korean: "주님", english: "the Lord", source: "lexicon" },
  { korean: "하나님", english: "God", source: "lexicon" },
  { korean: "예수님", english: "Jesus", source: "lexicon" },
  { korean: "그리스도", english: "Christ", source: "lexicon" },
  { korean: "천국", english: "the kingdom of heaven", alternatives: ["heaven"], source: "lexicon" },
  { korean: "하나님 나라", english: "the kingdom of God", source: "lexicon" },
  { korean: "영생", english: "eternal life", source: "lexicon" },
  { korean: "죄", english: "sin", source: "lexicon" },
  { korean: "죄인", english: "a sinner", source: "lexicon" },
  { korean: "심판", english: "judgement", source: "lexicon" },
  { korean: "택하신 족속", english: "a chosen people", note: "1 Peter 2:9", source: "lexicon" },
  { korean: "왕 같은 제사장", english: "a royal priesthood", note: "1 Peter 2:9", source: "lexicon" },
  { korean: "거룩한 나라", english: "a holy nation", note: "1 Peter 2:9", source: "lexicon" },
  { korean: "그의 소유가 된 백성", english: "God's special possession", note: "1 Peter 2:9", source: "lexicon" },
  { korean: "제사장", english: "priest", source: "lexicon" },
  { korean: "선지자", english: "prophet", source: "lexicon" },
  { korean: "사도", english: "apostle", source: "lexicon" },
  { korean: "이방인", english: "Gentiles", source: "lexicon" },
  { korean: "율법", english: "the law", alternatives: ["the Law of Moses"], source: "lexicon" },
  { korean: "은사", english: "spiritual gift", source: "lexicon" },
  { korean: "성품", english: "character", source: "lexicon" },
  { korean: "순종", english: "obedience", source: "lexicon" },
  { korean: "헌신", english: "commitment", alternatives: ["devotion"], source: "lexicon" },
  { korean: "섬김", english: "service", alternatives: ["serving"], source: "lexicon" },
  { korean: "십일조", english: "the tithe", source: "lexicon" },
  { korean: "감사", english: "thanksgiving", alternatives: ["gratitude"], source: "lexicon" },
  { korean: "찬송", english: "hymn", source: "lexicon" },
  { korean: "묵상", english: "meditation", alternatives: ["reflection"], source: "lexicon" },
  { korean: "큐티", english: "quiet time", note: "From English 'QT' — daily devotional reading", source: "lexicon" },
  { korean: "새벽기도", english: "early morning prayer", source: "lexicon" },
  { korean: "구역예배", english: "the small-group service", alternatives: ["cell group"], source: "lexicon" },
  { korean: "수련회", english: "the retreat", source: "lexicon" },
  { korean: "부흥회", english: "the revival meeting", source: "lexicon" },
];

/** Register and discourse vocabulary — active in BOTH modes. */
export const GENERAL_LEXICON: GlossaryItem[] = [
  { korean: "여러분", english: "everyone", note: "Often better dropped entirely in English", alternatives: ["you all", "—"], source: "lexicon", register: true },
  { korean: "말씀드리다", english: "to tell you", source: "lexicon", register: true },
  { korean: "다시 한번", english: "again", alternatives: ["once more"], source: "lexicon", register: true },
  { korean: "어떻게 보면", english: "in a sense", alternatives: ["—"], source: "lexicon", register: true },
  { korean: "사실은", english: "actually", alternatives: ["—"], source: "lexicon", register: true },
  { korean: "그래서", english: "so", source: "lexicon", register: true },
  { korean: "그러니까", english: "in other words", alternatives: ["so"], source: "lexicon", register: true },
  { korean: "결론적으로", english: "to sum up", source: "lexicon", register: true },
  { korean: "정리하자면", english: "to put it simply", source: "lexicon", register: true },
  { korean: "예를 들어", english: "for example", source: "lexicon", register: true },
  { korean: "한편으로는", english: "on one hand", source: "lexicon", register: true },
  { korean: "무엇보다", english: "above all", source: "lexicon", register: true },
];

export const lexiconFor = (mode: "sermon" | "general"): GlossaryItem[] =>
  mode === "sermon"
    ? [...THEOLOGICAL_LEXICON, ...GENERAL_LEXICON]
    : GENERAL_LEXICON;
