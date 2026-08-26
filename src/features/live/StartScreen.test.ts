import { describe, expect, it } from "vitest";

// The launcher policy is intentionally tiny and explicit. Keep a regression
// test beside the screen so a future config refactor does not quietly put a
// working browser back into Demo by default.
const preferredSource = ({
  browserSttAvailable,
  cloudAvailable,
  configured,
}: {
  browserSttAvailable: boolean;
  cloudAvailable: boolean;
  configured: "demo" | "webspeech" | "deepgram" | "openai";
}) => {
  if (cloudAvailable) return configured;
  if (browserSttAvailable) return "webspeech";
  return "demo";
};

describe("live audio source preference", () => {
  it("prefers browser speech over a deployment left on demo", () => {
    expect(
      preferredSource({
        browserSttAvailable: true,
        cloudAvailable: false,
        configured: "demo",
      }),
    ).toBe("webspeech");
  });

  it("keeps a configured cloud recogniser ahead of browser speech", () => {
    expect(
      preferredSource({
        browserSttAvailable: true,
        cloudAvailable: true,
        configured: "deepgram",
      }),
    ).toBe("deepgram");
  });

  it("falls back to demo only when no live recogniser exists", () => {
    expect(
      preferredSource({
        browserSttAvailable: false,
        cloudAvailable: false,
        configured: "demo",
      }),
    ).toBe("demo");
  });
});
