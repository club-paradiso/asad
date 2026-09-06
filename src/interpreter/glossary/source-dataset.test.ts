import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMUNITY_SERMON_GLOSSARY } from "./community-glossary";

const SOURCE_PATH = resolve(process.cwd(), "data/christian-glossary-500.tsv");

function sourceRows() {
  const [, ...rows] = readFileSync(SOURCE_PATH, "utf8").trimEnd().split("\n");
  return rows.map((row) => {
    const [number, category, korean, english] = row.split("\t");
    return { number: Number(number), category, korean, english };
  });
}

describe("Christian glossary source dataset", () => {
  it("preserves all 500 workbook rows and 447 unique Korean headwords", () => {
    const rows = sourceRows();
    expect(rows).toHaveLength(500);
    expect(rows.map((row) => row.number)).toEqual(
      Array.from({ length: 500 }, (_, index) => index + 1),
    );
    expect(new Set(rows.map((row) => row.korean)).size).toBe(447);
  });

  it("covers the same Korean headwords as the sermon runtime glossary", () => {
    const sourceKorean = new Set(sourceRows().map((row) => row.korean));
    const runtimeKorean = new Set(COMMUNITY_SERMON_GLOSSARY.map((item) => item.korean));

    expect(runtimeKorean).toEqual(sourceKorean);
  });
});
