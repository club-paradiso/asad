/**
 * Integrity of the archived Christian glossary workbook.
 *
 * `data/christian-glossary-500.tsv` is a preserved source file, NOT the input
 * `community-glossary.ts` was generated from. The two came from different
 * editions of the 「기독교 영단어 500개」 workbook and their vocabulary genuinely
 * differs: 371 Korean headwords are shared, 99 exist only in the TSV
 * (세상의 소금, 영혼 구원, 그리스도의 몸 …) and 76 only in the runtime layer
 * (설교, 예화, 적용, 지상명령 …).
 *
 * So this file asserts what is true of the archive itself — row count, row
 * numbering, category shape, well-formedness — and deliberately asserts nothing
 * about the runtime glossary. An equality between the two has never held, and
 * writing one down as a test made a green suite impossible rather than
 * describing anything the product relies on. Which edition ships is a product
 * decision; today the runtime layer is authoritative and this is an archive.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_PATH = resolve(process.cwd(), "data/christian-glossary-500.tsv");

function sourceRows() {
  const [, ...rows] = readFileSync(SOURCE_PATH, "utf8").trimEnd().split("\n");
  return rows.map((row) => {
    const [number, category, korean, english] = row.split("\t");
    return { number: Number(number), category, korean, english };
  });
}

describe("Christian glossary source dataset", () => {
  it("preserves all 500 workbook rows, numbered without a gap", () => {
    const rows = sourceRows();
    expect(rows).toHaveLength(500);
    expect(rows.map((row) => row.number)).toEqual(
      Array.from({ length: 500 }, (_, index) => index + 1),
    );
  });

  it("carries 470 unique Korean headwords across 30 duplicated rows", () => {
    const rows = sourceRows();
    const unique = new Set(rows.map((row) => row.korean));
    expect(unique.size).toBe(470);
    // Duplicates are kept on purpose: a repeated headword carries an alternate
    // English rendering for a different context.
    expect(rows.length - unique.size).toBe(30);
  });

  it("keeps the workbook's five categories at a hundred rows each", () => {
    const counts = new Map<string, number>();
    for (const row of sourceRows()) {
      counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(
      ["교회와 공동체", "구원론", "성경", "예배와 기도", "하나님·삼위일체"].sort(),
    );
    expect([...counts.values()]).toEqual([100, 100, 100, 100, 100]);
  });

  it("has no blank or untrimmed cell", () => {
    for (const row of sourceRows()) {
      expect(Number.isInteger(row.number)).toBe(true);
      for (const cell of [row.category, row.korean, row.english]) {
        expect(cell).toBeTruthy();
        expect(cell).toBe(cell.trim());
      }
    }
  });
});
