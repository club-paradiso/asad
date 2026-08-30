import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CounterMessage } from "@/counter/types";
import { ConversationView } from "./ConversationView";

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

const message = (overrides: Partial<CounterMessage> = {}): CounterMessage => ({
  id: "m1",
  seq: 1,
  from: "host",
  source: "text",
  originalText: "기한은 2026년 9월 7일입니다.",
  originalLang: "ko-KR",
  translatedText: "The deadline is September 17, 2026.",
  targetLang: "en-US",
  at: 1,
  status: "done",
  confidence: "low",
  criticalValues: [
    { kind: "date", text: "2026년 9월 7일", normalized: "2026-09-07" },
  ],
  integrity: {
    status: "mismatch",
    issues: [
      {
        kind: "date",
        sourceText: "2026년 9월 7일",
        targetText: "September 17, 2026",
        reason: "changed",
      },
    ],
  },
  ...overrides,
});

describe("Counter message actions", () => {
  it("shows a focused integrity warning and explicit recovery actions", () => {
    const onSimplify = vi.fn();
    const onRetry = vi.fn();
    const onConfirm = vi.fn();
    const value = message();
    render(
      <ConversationView
        messages={[value]}
        viewerRole="host"
        viewerLang="ko-KR"
        onSimplify={onSimplify}
        onRetry={onRetry}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText(/중요한 값이 원문과 다를 수 있어요/)).toBeTruthy();
    expect(screen.getByText(/2026년 9월 7일 → September 17, 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "더 쉽게" }));
    fireEvent.click(screen.getByRole("button", { name: "다시 번역" }));
    fireEvent.click(screen.getByRole("button", { name: "숫자 확인" }));
    expect(onSimplify).toHaveBeenCalledWith(value);
    expect(onRetry).toHaveBeenCalledWith(value);
    expect(onConfirm).toHaveBeenCalledWith(value);
  });

  it("never exposes a technical translation failure", () => {
    render(
      <ConversationView
        messages={[
          message({
            status: "failed",
            translatedText: "",
            confidence: undefined,
            integrity: undefined,
            criticalValues: undefined,
            error: "Provider quota exhausted: OPENAI_API_KEY",
          }),
        ]}
        viewerRole="host"
        viewerLang="ko-KR"
      />,
    );
    expect(screen.getByText("번역하지 못했습니다.")).toBeTruthy();
    expect(screen.queryByText(/quota|OPENAI|provider/i)).toBeNull();
  });
});
