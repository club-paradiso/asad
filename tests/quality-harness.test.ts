/**
 * The deterministic quality gate.
 *
 * Every threshold here is a product rule: an unnecessary repair on a live
 * console is worse than a missed one, a flipped negation must always be
 * caught, and a stylistic rewrite must never reach the interpreter's eye.
 */
import { describe, expect, it } from "vitest";
import { renderQualityReport, runQualityHarness } from "../benchmarks/quality";

describe("deterministic quality harness", () => {
  const report = runQualityHarness();

  it("never applies an unnecessary source repair", () => {
    const failures = report.sourceRepair.cases.filter((c) => !c.ok);
    expect(report.sourceRepair.unnecessaryRepairs, failures.map((c) => c.detail).join("\n")).toBe(0);
  });

  it("repairs a confirmed entity's corrupted surface form", () => {
    const failures = report.sourceRepair.cases.filter((c) => !c.ok);
    expect(report.sourceRepair.repairSuccess, failures.map((c) => `${c.id}: ${c.detail}`).join("\n")).toBe(
      report.sourceRepair.expectedRepairs,
    );
  });

  it("downgrades a weakly supported entity to a hypothesis", () => {
    expect(report.sourceRepair.hypothesisSuccess).toBe(report.sourceRepair.expectedHypotheses);
  });

  it("catches every dropped number, flipped negation, entity variant, script and echo", () => {
    const failures = report.targetCheck.cases.filter((c) => !c.ok);
    expect(report.targetCheck.recall, failures.map((c) => `${c.id}: ${c.detail}`).join("\n")).toBe(
      report.targetCheck.expectedFlags,
    );
  });

  it("raises no false alarm on a faithful rendering", () => {
    const failures = report.targetCheck.cases.filter((c) => !c.ok);
    expect(report.targetCheck.quiet, failures.map((c) => `${c.id}: ${c.detail}`).join("\n")).toBe(
      report.targetCheck.quietFixtures,
    );
  });

  it("agrees with every stability verdict", () => {
    const failures = report.stability.cases.filter((c) => !c.ok);
    expect(report.stability.agreement, failures.map((c) => `${c.id}: ${c.detail}`).join("\n")).toBe(
      report.stability.total,
    );
  });

  it("classifies every domain fixture", () => {
    const failures = report.domain.cases.filter((c) => !c.ok);
    expect(report.domain.correct, failures.map((c) => `${c.id}: ${c.detail}`).join("\n")).toBe(
      report.domain.total,
    );
  });

  it("renders a report without transcript-free claims it cannot back", () => {
    const markdown = renderQualityReport(report);
    expect(markdown).toContain("Provider quality is not measured here.");
  });
});
