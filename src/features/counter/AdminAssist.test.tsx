import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CounterMessage } from "@/counter/types";
import { analyzeUtterance } from "@/counter/admin/meaning";
import { assessTranslation } from "@/counter/admin/assess";
import { ConversationView } from "./ConversationView";

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

const visitorTurn = (overrides: Partial<CounterMessage> = {}): CounterMessage => ({
  id: "g1",
  seq: 1,
  from: "guest",
  source: "voice",
  originalText: "我想延期登录证。",
  originalLang: "zh-CN",
  translatedText: "등록증을 연장하고 싶어요.",
  targetLang: "ko-KR",
  at: 1,
  status: "done",
  confidence: "medium",
  integrity: assessTranslation("我想延期登录证。", "등록증을 연장하고 싶어요.", "zh-CN", "ko-KR"),
  analysis: analyzeUtterance({ text: "我想延期登录证。", lang: "zh-CN", otherLang: "ko-KR", inputMode: "voice", modelConfidence: "medium" }),
  ...overrides,
});

describe("staff assistance panel", () => {
  it("shows the ambiguity, both candidates and a neutral question — without touching the translation", () => {
    render(<ConversationView messages={[visitorTurn()]} viewerRole="host" viewerLang="ko-KR" />);
    expect(screen.getByText("등록증을 연장하고 싶어요.")).toBeTruthy();
    expect(screen.getByText("어느 절차인지 확인 필요")).toBeTruthy();
    expect(screen.getByRole("button", { name: /체류기간 연장허가/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /외국인등록증 재발급/ })).toBeTruthy();
    expect(screen.getByText(/체류기간을 연장하려고 오신 건가요/)).toBeTruthy();
    expect(screen.getByText("아직 사람이 확인하지 않았습니다.")).toBeTruthy();
  });

  it("sends the suggested question only when staff press the button, labelled as theirs", () => {
    const onAsk = vi.fn();
    render(
      <ConversationView messages={[visitorTurn()]} viewerRole="host" viewerLang="ko-KR" onAskClarification={onAsk} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "이 질문 보내기" }));
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }), expect.stringContaining("체류기간"));
    expect((screen.getByRole("button", { name: "보냄" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("records a confirmed candidate through the review callback", async () => {
    const onReview = vi.fn(async () => null);
    render(<ConversationView messages={[visitorTurn()]} viewerRole="host" viewerLang="ko-KR" onReview={onReview} />);
    fireEvent.click(screen.getByRole("button", { name: /체류기간 연장허가/ }));
    await waitFor(() => expect(onReview).toHaveBeenCalledWith("g1", "confirmed", "stay-extension"));
  });

  it("shows a review error next to the control instead of pretending it saved", async () => {
    const onReview = vi.fn(async () => "Staff authorisation required.");
    render(<ConversationView messages={[visitorTurn()]} viewerRole="host" viewerLang="ko-KR" onReview={onReview} />);
    fireEvent.click(screen.getByRole("button", { name: "확인함" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("says who decided only when a person did", () => {
    render(
      <ConversationView
        messages={[visitorTurn({ staffReview: { decision: "confirmed", conceptId: "stay-extension", at: 2 } })]}
        viewerRole="host"
        viewerLang="ko-KR"
        onReview={vi.fn(async () => null)}
      />,
    );
    expect(screen.getByText("직원 확인: 체류기간 연장허가")).toBeTruthy();
  });

  it("states a blocked verdict with severity for a critical meaning change", () => {
    const blocked = visitorTurn({
      from: "host",
      originalText: "체류기간 만료 전에 신청하셔야 합니다.",
      originalLang: "ko-KR",
      translatedText: "You may apply before your period of stay expires.",
      targetLang: "en-US",
      integrity: assessTranslation(
        "체류기간 만료 전에 신청하셔야 합니다.",
        "You may apply before your period of stay expires.",
        "ko-KR",
        "en-US",
      ),
      analysis: undefined,
    });
    render(<ConversationView messages={[blocked]} viewerRole="host" viewerLang="ko-KR" />);
    expect(screen.getByText(/의미·값 불일치/)).toBeTruthy();
    expect(screen.getByText(/\[치명\]/)).toBeTruthy();
  });

  it("never renders the staff panel on the visitor's screen", () => {
    render(<ConversationView messages={[visitorTurn()]} viewerRole="guest" viewerLang="zh-CN" />);
    expect(screen.queryByText("어느 절차인지 확인 필요")).toBeNull();
    expect(screen.queryByRole("button", { name: "이 질문 보내기" })).toBeNull();
  });
});

describe("visible corrections", () => {
  it("lets a sender correct their own message and keeps the original visible as replaced", () => {
    const onCorrect = vi.fn();
    const own = visitorTurn({ from: "guest", analysis: undefined });
    const { rerender } = render(
      <ConversationView messages={[own]} viewerRole="guest" viewerLang="zh-CN" onCorrect={onCorrect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "更正" }));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "我想延长滞留期间。" } });
    fireEvent.click(screen.getByRole("button", { name: "发送更正" }));
    expect(onCorrect).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }), "我想延长滞留期间。");

    const corrected = visitorTurn({
      id: "g2",
      seq: 2,
      originalText: "我想延长滞留期间。",
      translatedText: "체류기간을 연장하고 싶어요.",
      correctionOf: "g1",
      analysis: undefined,
    });
    rerender(<ConversationView messages={[own, corrected]} viewerRole="guest" viewerLang="zh-CN" onCorrect={onCorrect} />);
    expect(screen.getByText("已在下方更正")).toBeTruthy();
    expect(screen.getByText("更正后的内容")).toBeTruthy();
    // The original words are still on screen.
    expect(screen.getByText("我想延期登录证。")).toBeTruthy();
  });

  it("does not send an unchanged correction", () => {
    const onCorrect = vi.fn();
    render(
      <ConversationView messages={[visitorTurn({ analysis: undefined })]} viewerRole="guest" viewerLang="zh-CN" onCorrect={onCorrect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "更正" }));
    expect((screen.getByRole("button", { name: "发送更正" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
