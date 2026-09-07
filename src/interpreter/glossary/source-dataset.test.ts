/**
 * The archived Christian glossary workbook, and its agreement with the runtime.
 *
 * `data/christian-glossary-500.tsv` IS the source `community-glossary.ts` is
 * built from, and the cross-check below is the point of keeping it in the repo:
 * the archive and the runtime layer drifting apart silently is the failure this
 * file exists to catch. Both must agree on all 447 unique Korean headwords.
 *
 * A note on the counts, because they have been wrong once: the workbook has 500
 * numbered rows and 447 unique headwords, the difference being 53 rows that
 * repeat a headword to carry an alternate English rendering for a different
 * context. Ten categories of fifty. When the workbook is replaced, these
 * numbers move with it — and so must `community-glossary.ts`, in the same
 * change.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMUNITY_SERMON_GLOSSARY,
  COMMUNITY_SERMON_GLOSSARY_SOURCE_COUNT,
} from "./community-glossary";

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

  it("carries 447 unique Korean headwords across 53 repeated rows", () => {
    const rows = sourceRows();
    const unique = new Set(rows.map((row) => row.korean));
    expect(unique.size).toBe(447);
    expect(rows.length - unique.size).toBe(53);
  });

  it("keeps the workbook's ten categories at fifty rows each", () => {
    const counts = new Map<string, number>();
    for (const row of sourceRows()) {
      counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    }
    expect(counts.size).toBe(10);
    expect([...counts.values()]).toEqual(Array.from({ length: 10 }, () => 50));
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

  it("covers exactly the Korean headwords the sermon runtime glossary carries", () => {
    // The reason the archive is in the repo. If a future workbook adds a term,
    // this fails until `community-glossary.ts` is regenerated from it.
    const source = new Set(sourceRows().map((row) => row.korean));
    const runtime = new Set(COMMUNITY_SERMON_GLOSSARY.map((item) => item.korean));
    expect(runtime).toEqual(source);
    expect(COMMUNITY_SERMON_GLOSSARY_SOURCE_COUNT).toBe(500);
  });
});
