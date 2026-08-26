import { describe, expect, it } from "vitest";
import { preferredSttSource } from "./sourcePreference";

describe("preferredSttSource", () => {
  it("prefers browser speech over a deployment left on demo", () => {
    expect(
      preferredSttSource({
        browserSttAvailable: true,
        cloudAvailable: false,
        configured: "demo",
      }),
    ).toBe("webspeech");
  });

  it("keeps a configured cloud recogniser ahead of browser speech", () => {
    expect(
      preferredSttSource({
        browserSttAvailable: true,
        cloudAvailable: true,
        configured: "deepgram",
      }),
    ).toBe("deepgram");
  });

  it("falls back to demo only when no live recogniser exists", () => {
    expect(
      preferredSttSource({
        browserSttAvailable: false,
        cloudAvailable: false,
        configured: "demo",
      }),
    ).toBe("demo");
  });
});
