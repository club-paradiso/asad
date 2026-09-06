import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BidiText, segmentLtrRuns } from "./bidi";

const runs = (text: string) =>
  segmentLtrRuns(text)
    .filter((segment) => segment.kind === "ltr")
    .map((segment) => segment.text);

describe("left-to-right run detection", () => {
  it("keeps a range of status codes together as one run", () => {
    // The failure this exists for: three separate runs get laid out in RTL
    // order and "D-2 to D-10" is read as "D-10 to D-2". Both codes are
    // correct; the sentence is not.
    expect(runs("مەن D-2 to D-10 ئۆزگەرتمەكچى")).toEqual(["D-2 to D-10"]);
  });

  it("isolates administrative tokens inside RTL text", () => {
    expect(runs("ھۆججەت E-7")).toEqual(["E-7"]);
    expect(runs("HiKorea دا ئالدىن بېكىتىڭ")).toEqual(["HiKorea"]);
    expect(runs("ARC نى يوقىتىپ قويدۇم")).toEqual(["ARC"]);
    expect(runs("تېلېفون 1345 غا")).toEqual([]);
    expect(runs("2026-05-31 گىچە")).toEqual(["2026-05-31"]);
  });

  it("does not wrap a bare number, which the algorithm already places right", () => {
    expect(runs("3 ئاي")).toEqual([]);
  });

  it("does not swallow the whitespace that separates scripts", () => {
    const segments = segmentLtrRuns("ھۆججەت E-7 نومۇر");
    expect(segments.map((segment) => segment.text).join("")).toBe("ھۆججەت E-7 نومۇر");
  });

  it("round-trips arbitrary text without losing a character", () => {
    for (const text of [
      "E-7",
      "",
      "بۇ E-7 ۋە D-10 نى 2026-05-31 گىچە",
      "no rtl at all",
      "١٢٣ ٤٥٦",
    ]) {
      expect(segmentLtrRuns(text).map((segment) => segment.text).join("")).toBe(text);
    }
  });
});

describe("BidiText", () => {
  it("wraps left-to-right runs in an isolate when the paragraph is RTL", () => {
    render(
      <p dir="rtl" data-testid="line">
        <BidiText text="D-2 to D-10 گە" rtl />
      </p>,
    );
    const isolates = screen.getByTestId("line").querySelectorAll("bdi");
    expect(isolates).toHaveLength(1);
    expect(isolates[0].getAttribute("dir")).toBe("ltr");
    expect(isolates[0].textContent).toBe("D-2 to D-10");
  });

  it("adds no markup at all in a left-to-right paragraph", () => {
    // Every language that was already rendering correctly must keep rendering
    // exactly as it did.
    render(
      <p data-testid="line">
        <BidiText text="Change from D-2 to D-10" rtl={false} />
      </p>,
    );
    const line = screen.getByTestId("line");
    expect(line.querySelectorAll("bdi")).toHaveLength(0);
    expect(line.textContent).toBe("Change from D-2 to D-10");
  });

  it("keeps the full sentence readable", () => {
    render(
      <p data-testid="line" dir="rtl">
        <BidiText text="ھۆججەت E-7 نومۇر" rtl />
      </p>,
    );
    expect(screen.getByTestId("line").textContent).toBe("ھۆججەت E-7 نومۇر");
  });
});
