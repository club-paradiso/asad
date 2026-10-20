import { describe, expect, it, vi } from "vitest";
import { checkCandidate, chooseTranslation, criticalTokens, overlap, preservesCriticalTokens } from "./decision";
import { runEnsemble } from "./runner";

const source = "My E-7-1 extension has not been approved, and I paid 120,000 won.";
const index = "제 E-7-1 체류기간 연장은 아직 승인되지 않았고, 120,000원을 냈습니다.";
const azure = "E-7-1 체류기간 연장이 아직 승인되지 않았으며, 120,000원을 납부했습니다.";
const c = (provider: "index" | "azure", text: string) => ({ provider, text, latencyMs: 12 });

describe("earbud translation selection safety", () => {
  it("accepts faithful Korean hh시 mm분 for a source clock, but rejects changed minutes", () => {
    expect(preservesCriticalTokens("Come at 09:20", "09시 20분에 오세요.")).toBe(true);
    expect(preservesCriticalTokens("Come at 09:20", "09시 30분에 오세요.")).toBe(false);
  });
  it("validates Korean source into spoken English including negation and numbers", () => {
    const ko = "제 E-7-1 체류기간 연장은 아직 승인되지 않았고 120,000원을 냈습니다.";
    expect(checkCandidate(ko, "My E-7-1 extension has not been approved and I paid 120,000 won.", "en-US").ok).toBe(true);
    expect(checkCandidate(ko, "My E-7-1 extension was approved, I paid 120,000 won.", "en-US").ok).toBe(false);
    expect(checkCandidate(ko, "제 E-7-1 연장은 아직 승인되지 않았습니다. 120,000원", "en-US").ok).toBe(false);
    expect(checkCandidate(ko, "I have not received the approval letter.", "en-US").ok).toBe(false);
  });
  it("can select a matching English result from independent providers", () => {
    const ko = "제 E-7-1 체류기간 연장은 아직 승인되지 않았습니다.";
    const en = "My E-7-1 extension has not been approved.";
    expect(chooseTranslation(ko, [c("index", en), c("azure", en)], "en-US").kind).toBe("accepted");
  });
  it("retains all visa class and numeric identifiers", () => {
    expect(criticalTokens(source)).toEqual(expect.arrayContaining(["E-7-1", "120000"]));
    expect(checkCandidate(source, index).ok).toBe(true);
    expect(checkCandidate(source, "제 연장은 승인됐으며, 120,000원을 냈습니다.").ok).toBe(false);
    expect(checkCandidate(source, "제 E-7-1 연장은 승인됐습니다.").ok).toBe(false);
  });
  it("refuses missing Korean, model markup, and missing negation", () => {
    expect(checkCandidate(source, "Approved E-7-1 120,000").ok).toBe(false);
    expect(checkCandidate(source, "<think>ok</think> 제 E-7-1 연장은 아직 불허, 120,000원").ok).toBe(false);
    expect(checkCandidate(source, "제 E-7-1 연장이 승인됐고 120,000원을 냈습니다.").ok).toBe(false);
  });
  it("measures words without pretending overlap alone proves truth", () => {
    expect(overlap(index, index)).toBe(1);
    const chosen = chooseTranslation(source, [c("index", index), c("azure", azure)]);
    expect(chosen.kind).toBe("needs-judge");
  });
  it("accepts identical, validated independent translations", () => {
    const result = chooseTranslation(source, [c("index", index), c("azure", index)]);
    expect(result.kind).toBe("accepted");
    if (result.kind === "accepted") expect(result.candidate.provider).toBe("index");
  });
  it("abstains when one provider fails instead of treating a single answer as consensus", () => {
    expect(chooseTranslation(source, [c("index", index)]).kind).toBe("abstain");
  });
});
describe("parallel runner", () => {
  it("runs both providers and accepts matching results without paying for arbitration", async () => {
    const judge = vi.fn();
    const i = vi.fn(async () => index);
    const a = vi.fn(async () => index);
    const result = await runEnsemble({ text: source, source: "en-US" }, new AbortController().signal, {
      index: i, azure: a, judge,
    });
    expect(result.adjudication).toBe("agreement");
    expect(result.text).toBe(index);
    expect(i).toHaveBeenCalledOnce();
    expect(a).toHaveBeenCalledOnce();
    expect(judge).not.toHaveBeenCalled();
  });
  it("chooses an existing candidate only when the judge explicitly decides", async () => {
    const judge = vi.fn(async () => "azure" as const);
    const result = await runEnsemble({ text: source, source: "en-US" }, new AbortController().signal, {
      index: async () => index, azure: async () => azure, judge,
    });
    expect(result.adjudication).toBe("judge");
    expect(result.text).toBe(azure);
    expect(judge).toHaveBeenCalledOnce();
  });
  it("abstains on disagreements without a judge", async () => {
    const result = await runEnsemble({ text: source, source: "en-US" }, new AbortController().signal, {
      index: async () => index, azure: async () => azure,
    });
    expect(result.text).toBeNull();
    expect(result.confidence).toBe("low");
  });
  it("abstains on missing provider responses and judge failure", async () => {
    const result = await runEnsemble({ text: source, source: "en-US" }, new AbortController().signal, {
      index: async () => { throw new Error("offline"); },
      azure: async () => azure, judge: async () => { throw new Error("429"); },
    });
    expect(result.text).toBeNull();
  });
  it("timeboxes a vendor promise that ignores cancellation instead of hanging the other model", async () => {
    const start = Date.now();
    const result = await runEnsemble({ text: source, source: "en-US" }, new AbortController().signal, {
      index: async () => new Promise<string>(() => {}),
      azure: async () => azure,
      candidateTimeoutMs: 25,
    });
    expect(result.adjudication).toBe("abstain");
    expect(Date.now() - start).toBeLessThan(1000);
  });
  it("stops promptly on caller abort even if a vendor never resolves", async () => {
    const controller = new AbortController();
    const running = runEnsemble({ text: source, source: "en-US" }, controller.signal, {
      index: async () => new Promise<string>(() => {}),
      azure: async () => new Promise<string>(() => {}),
      candidateTimeoutMs: 5000,
    });
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });
  it("never emits a malformed third-model choice", async () => {
    const result = await runEnsemble({ text: source, source: "en-US" }, new AbortController().signal, {
      index: async () => index, azure: async () => azure,
      judge: async () => "abstain",
    });
    expect(result.adjudication).toBe("abstain");
  });
});
