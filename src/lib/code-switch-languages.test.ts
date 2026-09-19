/**
 * The multilingual matrix.
 *
 * One fixture per way a Korean speaker actually reaches for another language
 * mid-sentence, plus the inverse direction, plus — and this half matters just
 * as much — the pairs where the writing system CANNOT tell the two languages
 * apart and the only correct answer is to say so.
 *
 * The shape of the bug this pins is always the same. A recogniser or a
 * downstream layer that believes "this session is Korean, therefore every
 * character should be Hangul" will quietly destroy 社会资本, социальный капитал,
 * رأس المال الاجتماعي and सामाजिक पूंजी exactly as it destroyed *social
 * capital*. The first fix only covered Latin; this covers the writing systems.
 */
import { describe, expect, it } from "vitest";
import {
  analyseCodeSwitch,
  isAlreadyTargetLanguage,
  notableTermsIn,
  pairIsScriptDecidable,
  truncateTerm,
} from "./code-switch";

const pair = (source: string, target: string) => ({ source, target });

/* --------------------------------------------------------------------------
 * Korean mixed with each writing system the product serves
 * ------------------------------------------------------------------------ */

interface Fixture {
  name: string;
  target: string;
  text: string;
  /** Spans that must survive downstream, verbatim. */
  preserved: string[];
}

const KOREAN_FIXTURES: Fixture[] = [
  {
    name: "English",
    target: "en-US",
    text: "오늘 핵심 개념은 social capital입니다.",
    preserved: ["social capital"],
  },
  {
    name: "Simplified Chinese",
    target: "zh-CN",
    text: "여기서 社会资本이라는 개념이 중요합니다.",
    preserved: ["社会资本"],
  },
  {
    name: "Traditional Chinese",
    target: "zh-TW",
    text: "오늘 핵심 개념은 社會資本입니다.",
    preserved: ["社會資本"],
  },
  {
    name: "Chinese, a second topic",
    target: "zh-CN",
    text: "이번 행사의 주제는 数字化转型입니다.",
    preserved: ["数字化转型"],
  },
  {
    name: "Japanese, Han only",
    target: "ja-JP",
    text: "이 부분은 観光政策하고 연결됩니다.",
    preserved: ["観光政策"],
  },
  {
    name: "Japanese, Han and Kana together",
    target: "ja-JP",
    text: "오늘 주제는 地域社会와 コミュニティ입니다.",
    preserved: ["地域社会", "コミュニティ"],
  },
  {
    name: "Japanese, Kana only",
    target: "ja-JP",
    text: "일본에서는 おもてなし라는 표현도 많이 쓰죠.",
    preserved: ["おもてなし"],
  },
  {
    name: "Russian",
    target: "ru-RU",
    text: "오늘 핵심 개념은 социальный капитал입니다.",
    preserved: ["социальный капитал"],
  },
  {
    name: "Russian, a civil-society term",
    target: "ru-RU",
    text: "러시아에서는 гражданское общество라는 표현도 중요합니다.",
    preserved: ["гражданское общество"],
  },
  {
    name: "Mongolian",
    target: "mn-MN",
    text: "몽골어로는 нийгмийн капитал이라고 합니다.",
    preserved: ["нийгмийн капитал"],
  },
  {
    name: "Mongolian, artificial intelligence",
    target: "mn-MN",
    text: "여기서는 хиймэл оюун ухаан이라는 표현을 씁니다.",
    preserved: ["хиймэл оюун ухаан"],
  },
  {
    name: "Arabic",
    target: "ar-SA",
    text: "오늘 주제는 رأس المال الاجتماعي입니다.",
    preserved: ["رأس المال الاجتماعي"],
  },
  {
    name: "Arabic, civil society",
    target: "ar-SA",
    text: "이 개념은 المجتمع المدني와 연결됩니다.",
    preserved: ["المجتمع المدني"],
  },
  {
    name: "Hindi",
    target: "hi-IN",
    text: "오늘 핵심 표현은 सामाजिक पूंजी입니다.",
    preserved: ["सामाजिक पूंजी"],
  },
  {
    name: "Hindi, artificial intelligence",
    target: "hi-IN",
    text: "인공지능은 힌디어로 कृत्रिम बुद्धिमत्ता라고 합니다.",
    preserved: ["कृत्रिम बुद्धिमत्ता"],
  },
  {
    name: "Thai",
    target: "th-TH",
    text: "태국어로는 ทุนทางสังคม이라고 합니다.",
    preserved: ["ทุนทางสังคม"],
  },
  {
    name: "Thai, artificial intelligence",
    target: "th-TH",
    text: "여기서 ปัญญาประดิษฐ์라는 표현을 씁니다.",
    preserved: ["ปัญญาประดิษฐ์"],
  },
  {
    name: "Vietnamese",
    target: "vi-VN",
    text: "베트남어로는 vốn xã hội라고 합니다.",
    preserved: ["vốn xã hội"],
  },
  {
    name: "Vietnamese, artificial intelligence",
    target: "vi-VN",
    text: "여기서는 trí tuệ nhân tạo라는 표현을 씁니다.",
    preserved: ["trí tuệ nhân tạo"],
  },
  {
    name: "Indonesian",
    target: "id-ID",
    text: "인도네시아어로는 modal sosial이라고 합니다.",
    preserved: ["modal sosial"],
  },
  {
    name: "Indonesian, digital transformation",
    target: "id-ID",
    text: "이번 주제는 transformasi digital입니다.",
    preserved: ["transformasi digital"],
  },
];

describe("a Korean speaker reaching for another language", () => {
  for (const fixture of KOREAN_FIXTURES) {
    it(`preserves ${fixture.name}`, () => {
      const languages = pair("ko-KR", fixture.target);
      const analysis = analyseCodeSwitch(fixture.text, languages);

      expect(analysis.decidable).toBe(true);
      expect(analysis.dominant).toBe("mixed");
      for (const span of fixture.preserved) {
        expect(analysis.guestTerms).toContain(span);
      }
      // Korean is still the dominant language of a Korean sentence carrying a
      // foreign noun phrase; nothing here should read as a language change.
      expect(analysis.sourceRatio).toBeGreaterThan(0);
      expect(isAlreadyTargetLanguage(fixture.text, languages)).toBe(false);
    });
  }
});

/* --------------------------------------------------------------------------
 * The inverse direction
 * ------------------------------------------------------------------------ */

describe("an English speaker reaching for another language", () => {
  const FIXTURES: Array<[string, string, string]> = [
    ["zh-CN", "The key concept today is 社会资本.", "社会资本"],
    ["ja-JP", "The next topic is 地域社会.", "地域社会"],
    ["ru-RU", "The Russian term is социальный капитал.", "социальный капитал"],
    ["mn-MN", "In Mongolian this is called нийгмийн капитал.", "нийгмийн капитал"],
    ["ar-SA", "The Arabic term is رأس المال الاجتماعي.", "رأس المال الاجتماعي"],
    ["hi-IN", "The Hindi expression is सामाजिक पूंजी.", "सामाजिक पूंजी"],
    ["ko-KR", "The Korean term is 사회적 자본.", "사회적 자본"],
  ];

  for (const [target, text, span] of FIXTURES) {
    it(`preserves ${target}`, () => {
      const analysis = analyseCodeSwitch(text, pair("en-US", target));
      expect(analysis.decidable).toBe(true);
      expect(analysis.guestTerms).toContain(span);
      expect(analysis.mixed).toBe(true);
    });
  }
});

describe("a non-Latin speaker reaching for English technical vocabulary", () => {
  it("keeps English terms inside Russian", () => {
    const analysis = analyseCodeSwitch(
      "Компания использует machine learning и OpenAI API.",
      pair("ru-RU", "en-US"),
    );
    expect(analysis.guestTerms).toContain("machine learning");
    expect(analysis.guestTerms).toContain("OpenAI API");
  });

  it("keeps a status code inside Russian", () => {
    const analysis = analyseCodeSwitch(
      "Этот endpoint возвращает HTTP 403.",
      pair("ru-RU", "en-US"),
    );
    expect(analysis.guestTerms).toContain("HTTP 403");
  });

  it("keeps English terms inside Mongolian, which is not Russian", () => {
    const analysis = analyseCodeSwitch(
      "Өнөөдөр бид social capital-ийн талаар ярилцана.",
      pair("mn-MN", "en-US"),
    );
    // The hyphenated Mongolian case ending rides along with the term it
    // attaches to; what matters is that the English survives at all.
    expect(analysis.guestTerms.join(" ")).toContain("social capital");
    expect(analysis.decidable).toBe(true);
  });

  it("keeps English terms inside Arabic", () => {
    const analysis = analyseCodeSwitch(
      "نستخدم machine learning و GPT-4 في هذا المشروع.",
      pair("ar-SA", "en-US"),
    );
    expect(analysis.guestTerms).toContain("machine learning");
    expect(analysis.guestTerms).toContain("GPT-4");
  });

  it("keeps English terms inside Hindi", () => {
    const analysis = analyseCodeSwitch(
      "हम इस प्रोजेक्ट में machine learning और OpenAI API का उपयोग करते हैं।",
      pair("hi-IN", "en-US"),
    );
    expect(analysis.guestTerms).toContain("machine learning");
    expect(analysis.guestTerms).toContain("OpenAI API");
  });

  it("keeps English terms inside Thai", () => {
    const analysis = analyseCodeSwitch(
      "เราใช้ machine learning ในโครงการนี้",
      pair("th-TH", "en-US"),
    );
    expect(analysis.guestTerms).toContain("machine learning");
  });
});

/* --------------------------------------------------------------------------
 * Same-script pairs: the negative capability
 * ------------------------------------------------------------------------ */

describe("pairs a writing system cannot separate", () => {
  const UNDECIDABLE: Array<[string, string, string]> = [
    ["en-US", "vi-VN", "both are written in Latin"],
    ["en-US", "id-ID", "both are written in Latin"],
    ["vi-VN", "id-ID", "both are written in Latin"],
    ["ru-RU", "mn-MN", "both are written in Cyrillic"],
    ["ru-RU", "uk-UA", "both are written in Cyrillic"],
    ["ar-SA", "ur-PK", "both are written in the Arabic script"],
    ["zh-CN", "zh-TW", "both are written in Han characters"],
  ];

  for (const [source, target, why] of UNDECIDABLE) {
    it(`refuses to read ${source} against ${target}, because ${why}`, () => {
      expect(pairIsScriptDecidable(source, target)).toBe(false);
    });
  }

  it("says nothing about an English sentence in an English↔Vietnamese session", () => {
    // The speaker may well have switched. Script evidence simply cannot say so,
    // and inventing the claim is the failure the module exists to refuse.
    const analysis = analyseCodeSwitch(
      "Hôm nay chúng ta sẽ nói về social capital và machine learning.",
      pair("vi-VN", "en-US"),
    );
    expect(analysis.decidable).toBe(false);
    expect(analysis.dominant).toBe("unknown");
    expect(analysis.mixed).toBe(false);
  });

  it("says nothing about an English sentence in an English↔Indonesian session", () => {
    const analysis = analyseCodeSwitch(
      "Hari ini kita membahas social capital dan machine learning.",
      pair("id-ID", "en-US"),
    );
    expect(analysis.decidable).toBe(false);
    expect(analysis.dominant).toBe("unknown");
  });

  it("never calls a Cyrillic span Russian merely because it is Cyrillic", () => {
    // The single most important negative case in this file. Russian and
    // Mongolian are both Cyrillic in this registry, so a Mongolian phrase in a
    // Russian session is indistinguishable from Russian — and vice versa.
    const analysis = analyseCodeSwitch(
      "Өнөөдөр бид нийгмийн капитал ярилцана.",
      pair("ru-RU", "mn-MN"),
    );
    expect(analysis.decidable).toBe(false);
    expect(analysis.dominant).toBe("unknown");
  });

  it("still protects identifiers when the pair cannot be read", () => {
    // Script-independent evidence survives: a label is a label in any language.
    const analysis = analyseCodeSwitch(
      "Chúng tôi dùng GPT-4 và nhận HTTP 403 từ API.",
      pair("vi-VN", "en-US"),
    );
    expect(analysis.guestTerms).toEqual(["GPT-4", "HTTP 403", "API"]);
  });

  it("refuses target-language passthrough for a pair it cannot read", () => {
    // Passing source speech through untranslated is a far worse failure than
    // translating a quotation twice, so an undecidable pair never risks it.
    expect(
      isAlreadyTargetLanguage(
        "We should talk about social capital today.",
        pair("vi-VN", "en-US"),
      ),
    ).toBe(false);
    expect(
      isAlreadyTargetLanguage("Нийгмийн капитал гэдэг ойлголт.", pair("ru-RU", "mn-MN")),
    ).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * Target-language passthrough, across genuinely readable pairs
 * ------------------------------------------------------------------------ */

describe("a whole sentence delivered in the target language", () => {
  const PASSTHROUGH: Array<[string, string, string]> = [
    ["ko-KR", "en-US", "I don't think that's the point."],
    ["ko-KR", "zh-CN", "我认为这不是重点所在。"],
    ["ko-KR", "zh-TW", "我認為這不是重點所在。"],
    ["ko-KR", "ja-JP", "それが要点ではないと思います。"],
    ["ko-KR", "ru-RU", "Я не думаю, что это главное."],
    ["ko-KR", "mn-MN", "Энэ бол гол санаа биш гэж бодож байна."],
    ["ko-KR", "ar-SA", "لا أعتقد أن هذه هي النقطة الأساسية."],
    ["ko-KR", "hi-IN", "मुझे नहीं लगता कि यही मुख्य बात है।"],
    ["ko-KR", "th-TH", "ผมไม่คิดว่านั่นคือประเด็นสำคัญ"],
    ["ko-KR", "vi-VN", "Tôi không nghĩ đó là vấn đề chính."],
    ["ko-KR", "id-ID", "Saya rasa itu bukan intinya."],
    ["en-US", "ko-KR", "그게 요점은 아니라고 생각합니다."],
    ["en-US", "zh-CN", "我认为这不是重点所在。"],
    ["en-US", "ja-JP", "それが要点ではないと思います。"],
    ["en-US", "ru-RU", "Я не думаю, что это главное."],
    ["en-US", "mn-MN", "Энэ бол гол санаа биш гэж бодож байна."],
    ["en-US", "ar-SA", "لا أعتقد أن هذه هي النقطة الأساسية."],
    ["en-US", "hi-IN", "मुझे नहीं लगता कि यही मुख्य बात है।"],
  ];

  for (const [source, target, text] of PASSTHROUGH) {
    it(`renders ${source} → ${target} verbatim instead of translating it again`, () => {
      expect(isAlreadyTargetLanguage(text, pair(source, target))).toBe(true);
    });
  }

  it("never passes source speech through", () => {
    // The failure that would matter: Korean reaching the screen untranslated.
    expect(
      isAlreadyTargetLanguage("오늘 우리가 함께 살펴볼 내용입니다.", pair("ko-KR", "zh-CN")),
    ).toBe(false);
    expect(
      isAlreadyTargetLanguage("오늘 우리가 함께 살펴볼 내용입니다.", pair("ko-KR", "ar-SA")),
    ).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * Unicode integrity
 * ------------------------------------------------------------------------ */

describe("Unicode integrity", () => {
  it("keeps Devanagari matras attached to their base letters", () => {
    // कृत्रिम is क + ृ + त + ् + र + ि + म. Classifying combining marks on
    // their own would let a run be cut between a consonant and its vowel.
    const analysis = analyseCodeSwitch(
      "인공지능은 कृत्रिम बुद्धिमत्ता라고 합니다.",
      pair("ko-KR", "hi-IN"),
    );
    const [term] = analysis.guestTerms;
    expect(term).toBe("कृत्रिम बुद्धिमत्ता");
    expect([...term].length).toBe([..."कृत्रिम बुद्धिमत्ता"].length);
  });

  it("keeps Arabic text whole and in source order", () => {
    const text = "رأس المال الاجتماعي";
    const analysis = analyseCodeSwitch(`오늘 주제는 ${text}입니다.`, pair("ko-KR", "ar-SA"));
    // Byte-for-byte: nothing reordered, nothing normalised, no bidi control
    // characters inserted. Direction is a rendering concern the registry
    // already carries; it is not this layer's business to rewrite the string.
    expect(analysis.guestTerms[0]).toBe(text);
  });

  it("keeps Vietnamese tone marks, which the old Latin range silently dropped", () => {
    // `[A-Za-zÀ-ɏ]` stops before Latin Extended Additional, so `hội`,
    // `ế`, `ộ` and `ữ` were not Latin as far as the product was concerned.
    const analysis = analyseCodeSwitch(
      "베트남어로는 vốn xã hội라고 합니다.",
      pair("ko-KR", "vi-VN"),
    );
    expect(analysis.guestTerms).toContain("vốn xã hội");
    expect(notableTermsIn("Chúng tôi dùng trí tuệ nhân tạo và GPT-4o.")).toContain("GPT-4o");
  });

  it("keeps a Thai run whole without inserting word breaks", () => {
    // Thai does not separate every lexical word with a space, so a run is the
    // whole phrase and nothing may be pushed into it.
    const analysis = analyseCodeSwitch(
      "태국어로는 ทุนทางสังคม이라고 합니다.",
      pair("ko-KR", "th-TH"),
    );
    expect(analysis.guestTerms).toEqual(["ทุนทางสังคม"]);
  });

  it("truncates a long run by syllable rather than by UTF-16 unit", () => {
    // The cap on a term's length is a bound on how much a caller can be handed,
    // not a licence to hand them a broken word. Arabic, Devanagari and Thai all
    // write one syllable as a base letter plus its marks, and a cut between the
    // two produces a string that is not a word in any language.
    expect(truncateTerm("สวัสดี", 100)).toBe("สวัสดี");
    // ب + ِ is one written syllable. Cutting at an odd length must drop both.
    expect(truncateTerm("بِبِبِ", 3)).toBe("بِ");
    expect(truncateTerm("بِبِبِ", 4)).toBe("بِبِ");
    // And nothing is normalised on the way through: an unbroken term is
    // returned as the same string it arrived as.
    const thai = "ทุนทางสังคม";
    expect(truncateTerm(thai, thai.length)).toBe(thai);
  });

  it("treats a shared block as evidence for neither side", () => {
    // Japanese and Chinese both use Han, so a kanji proves nothing in a ja↔zh
    // session and only kana can settle it. Here one と is the entire evidence,
    // and it points at Japanese — which is the correct reading, and not the
    // "mixed" a ratio threshold alone would have produced.
    const analysis = analyseCodeSwitch("地域社会と観光政策", pair("ja-JP", "zh-CN"));
    expect(analysis.targetRatio).toBe(0);
    expect(analysis.dominant).toBe("source");
    // Eight of the nine characters were claimed by both patterns and counted
    // toward neither.
    expect(analysis.sourceRatio).toBeLessThan(0.2);
  });

  it("has no opinion when a shared block is all there is", () => {
    const analysis = analyseCodeSwitch("地域社会観光政策", pair("ja-JP", "zh-CN"));
    expect(analysis.dominant).toBe("unknown");
    expect(analysis.sourceRatio).toBe(0);
    expect(analysis.targetRatio).toBe(0);
  });
});

/* --------------------------------------------------------------------------
 * A third language nobody expected
 * ------------------------------------------------------------------------ */

describe("a script belonging to neither side", () => {
  it("is preserved and flagged, never classified", () => {
    // A Korean→English session in which the speaker quotes Russian. There is no
    // basis for calling it Russian rather than Ukrainian or Mongolian, and the
    // module does not try — it reports that something unexpected appeared.
    const analysis = analyseCodeSwitch(
      "러시아어로는 социальный капитал이라고 합니다.",
      pair("ko-KR", "en-US"),
    );
    expect(analysis.unexpectedScript).toBe(true);
    expect(analysis.guestTerms).toContain("социальный капитал");
  });

  it("is not flagged when both sides account for everything present", () => {
    const analysis = analyseCodeSwitch(
      "오늘 핵심 개념은 social capital입니다.",
      pair("ko-KR", "en-US"),
    );
    expect(analysis.unexpectedScript).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * Terms a prep sheet contributes, in any script
 * ------------------------------------------------------------------------ */

describe("terms pulled out of a prep sheet", () => {
  it("finds proper nouns and identifiers", () => {
    const terms = notableTermsIn(
      "Today Putnam speaks about social capital. Ask about the E-7 visa and GPT-4o.",
    );
    expect(terms).toContain("Putnam");
    expect(terms).toContain("E-7");
    expect(terms).toContain("GPT-4o");
  });

  it("does not try to mine a caseless script out of free prose", () => {
    // A documented limit rather than an oversight. "Notable" is recognised from
    // capitalisation and from digits, and Han, Thai, Devanagari and Arabic have
    // no case — so every word in a Chinese paragraph would qualify equally and
    // the list would be flooded with ordinary vocabulary.
    //
    // Prepared multilingual forms reach the recogniser by the route built for
    // them: the prep sheet's glossary and entity fields, which carry both
    // languages' spellings explicitly and are added ahead of this scan.
    expect(notableTermsIn("오늘 社会资本 개념을 다룹니다.")).toEqual([]);
  });

  it("does not mistake an ordinary sentence opener for a proper noun", () => {
    expect(notableTermsIn("Today we discuss the rollout.")).toEqual([]);
  });

  it("is bounded", () => {
    const many = Array.from({ length: 200 }, (_, i) => `Term${i}`).join(" and ");
    expect(notableTermsIn(many).length).toBeLessThanOrEqual(12);
  });
});
