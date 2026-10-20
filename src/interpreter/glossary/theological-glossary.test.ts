import { describe, expect, it } from "vitest";
import {
  applyGlossaryPack,
  GLOSSARY_PACK_CATEGORIES,
  GLOSSARY_PACK_MIN_ENTRIES,
  packGlossaryItems,
  THEOLOGICAL_GLOSSARY,
} from "./theological-glossary";
import { lexiconFor, THEOLOGICAL_LEXICON } from "./lexicon";
import { matchGlossary } from "./matcher";

describe("theological glossary pack data", () => {
  it("carries at least the required entries", () => {
    expect(THEOLOGICAL_GLOSSARY.length).toBeGreaterThanOrEqual(GLOSSARY_PACK_MIN_ENTRIES);
    expect(THEOLOGICAL_GLOSSARY.length).toBeGreaterThanOrEqual(60);
  });

  it("has unique Korean headwords", () => {
    const keys = THEOLOGICAL_GLOSSARY.map((entry) => entry.ko);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers the required theological categories", () => {
    for (const category of ["구원론", "교리", "예배", "성경", "직분"]) {
      expect(GLOSSARY_PACK_CATEGORIES).toContain(category);
    }
  });

  it("carries English and Chinese renderings for every entry", () => {
    for (const entry of THEOLOGICAL_GLOSSARY) {
      expect(entry.en.trim().length).toBeGreaterThan(0);
      expect(entry.zh.trim().length).toBeGreaterThan(0);
    }
  });

  it("covers the required core vocabulary", () => {
    const byKo = new Map(THEOLOGICAL_GLOSSARY.map((entry) => [entry.ko, entry]));
    const required: Array<[string, string]> = [
      ["칭의", "justification"],
      ["성화", "sanctification"],
      ["중생", "regeneration"],
      ["속죄", "atonement"],
      ["은혜", "grace"],
      ["구원", "salvation"],
      ["회개", "repentance"],
      ["세례", "baptism"],
      ["성찬", "Communion"],
      ["십자가", "the cross"],
      ["부활", "the resurrection"],
      ["승천", "the ascension"],
      ["재림", "the Second Coming"],
      ["삼위일체", "the Trinity"],
      ["성령", "the Holy Spirit"],
      ["교회", "the church"],
      ["목사", "pastor"],
      ["장로", "elder"],
      ["집사", "deacon"],
      ["권사", "senior deaconess"],
      ["예배", "worship"],
      ["설교", "sermon"],
      ["기도", "prayer"],
      ["찬양", "praise"],
      ["헌금", "offering"],
      ["선교", "missions"],
      ["전도", "evangelism"],
      ["제자", "disciple"],
      ["천국", "the kingdom of heaven"],
      ["지옥", "hell"],
      ["죄", "sin"],
      ["용서", "forgiveness"],
      ["믿음", "faith"],
      ["소망", "hope"],
      ["사랑", "love"],
      ["말씀", "the Word"],
      ["진리", "truth"],
      ["생명", "life"],
      ["목자", "shepherd"],
      ["포도나무", "the vine"],
    ];
    for (const [ko, en] of required) {
      expect(byKo.get(ko)?.en, ko).toBe(en);
    }
  });
});

describe("applyGlossaryPack", () => {
  it("is a no-op outside worship", () => {
    const items = lexiconFor("meeting");
    expect(applyGlossaryPack(items, "meeting")).toBe(items);
  });

  it("puts the pack standard first while keeping lexicon guidance", () => {
    const merged = applyGlossaryPack(lexiconFor("worship"), "worship");
    const grace = merged.find((item) => item.korean === "은혜");
    expect(grace?.english).toBe("grace");
    expect(grace?.source).toBe("glossary-pack");
    // The hand-curated lexicon's alternatives survive where the pack is silent.
    expect(grace?.alternatives).toContain("blessing");
    // The pack's own note carries the greeting guidance the lexicon taught.
    expect(grace?.note).toMatch(/blessing/);
  });

  it("adds pack-only headwords the lexicon never had", () => {
    const lexiconKeys = new Set(THEOLOGICAL_LEXICON.map((item) => item.korean));
    const merged = applyGlossaryPack(lexiconFor("worship"), "worship");
    for (const key of ["중생", "승천", "재림", "지옥", "포도나무"]) {
      expect(lexiconKeys.has(key)).toBe(false);
      expect(merged.find((item) => item.korean === key)?.source).toBe("glossary-pack");
    }
  });

  it("never lets the pack outrank a prep-sheet decision", () => {
    const prep = [{ korean: "은혜", english: "favour", source: "prep" as const }];
    const matches = matchGlossary("은혜가 충만합니다", "worship", prep);
    expect(matches[0]?.source).toBe("prep");
    expect(matches[0]?.english).toBe("favour");
  });

  it("surfaces the pack standard on the live rail", () => {
    const matches = matchGlossary("중생과 성화의 은혜를 나눕니다", "worship");
    const byKo = new Map(matches.map((match) => [match.korean, match]));
    expect(byKo.get("중생")?.english).toBe("regeneration");
    expect(byKo.get("성화")?.source).toBe("glossary-pack");
  });

  it("exposes the pack as engine items tagged with its source", () => {
    const items = packGlossaryItems();
    expect(items.length).toBe(THEOLOGICAL_GLOSSARY.length);
    expect(items.every((item) => item.source === "glossary-pack")).toBe(true);
  });

  it("agrees with the hand-curated lexicon on overlapping headwords", () => {
    // The lexicon's primary renderings are deliberate, context-aware decisions
    // (e.g. 대속 → atonement, with "substitutionary atonement" as an
    // alternative). The pack standardises; it must not silently overturn them.
    const curatedEn = new Map(
      THEOLOGICAL_LEXICON.map((item) => [item.korean, item.english]),
    );
    const conflicts: string[] = [];
    for (const entry of THEOLOGICAL_GLOSSARY) {
      const curated = curatedEn.get(entry.ko);
      if (curated && curated !== entry.en) {
        conflicts.push(`${entry.ko}: pack=${entry.en} lexicon=${curated}`);
      }
    }
    expect(conflicts).toEqual([]);
  });
});
