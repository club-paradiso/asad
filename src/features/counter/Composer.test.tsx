import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stringsFor } from "@/counter/ui-strings";
import { Composer } from "./Composer";

const voice = vi.hoisted(() => ({
  supported: true,
  phase: "idle" as "idle" | "connecting" | "listening" | "finishing" | "unavailable",
  listening: false,
  partial: "",
  failure: null as null | "permission" | "no-speech" | "unavailable" | "failed" | "stopped",
  usedFallback: false,
  start: vi.fn<() => Promise<string>>(),
  stop: vi.fn(),
  dismissError: vi.fn(),
}));

vi.mock("./useVoiceInput", () => ({ useVoiceInput: () => voice }));

describe("Counter Composer", () => {
  beforeEach(() => {
    voice.supported = true;
    voice.phase = "idle";
    voice.listening = false;
    voice.partial = "";
    voice.failure = null;
    voice.usedFallback = false;
    voice.start.mockReset();
    voice.stop.mockReset();
    voice.dismissError.mockReset();
  });

  it("makes voice the primary 80px action while typing remains available", () => {
    voice.start.mockResolvedValue("");
    render(<Composer lang="ko-KR" strings={stringsFor("ko-KR")} onSend={vi.fn()} />);
    const microphone = screen.getByRole("button", { name: "말하기" });
    expect(microphone.className).toContain("size-20");
    expect(screen.getByPlaceholderText("내용을 입력하세요")).toBeTruthy();
  });

  it("confirms critical values before sending a spoken turn", async () => {
    const onSend = vi.fn();
    voice.start.mockResolvedValue("체류기간은 9월 7일까지예요");
    render(<Composer lang="ko-KR" strings={stringsFor("ko-KR")} onSend={onSend} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "말하기" })); });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByText(/“9월 7일” 맞나요/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "맞아요" }));
    expect(onSend).toHaveBeenCalledWith("체류기간은 9월 7일까지예요", "voice");
  });

  it("never disables typing when voice is unavailable", () => {
    voice.supported = false;
    voice.phase = "unavailable";
    voice.failure = "unavailable";
    const onSend = vi.fn();
    render(<Composer lang="en-US" strings={stringsFor("en-US")} onSend={onSend} />);
    const input = screen.getByPlaceholderText("Type your message");
    fireEvent.change(input, { target: { value: "I need help" } });
    fireEvent.submit(input.closest("form")!);
    expect(onSend).toHaveBeenCalledWith("I need help", "text");
    expect(screen.queryByText(/Deepgram|OpenAI|provider/i)).toBeNull();
  });

  it("keeps typing enabled while a previous translation is still busy", () => {
    render(
      <Composer
        lang="ko-KR"
        strings={stringsFor("ko-KR")}
        busy
        onSend={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("내용을 입력하세요") as HTMLInputElement;
    expect(input.disabled).toBe(false);
    fireEvent.change(input, { target: { value: "다음 문장도 입력돼요" } });
    expect(input.value).toBe("다음 문장도 입력돼요");
  });

  it("keeps a submitted typed turn recoverable and prevents accidental duplicate send", () => {
    const onSend = vi.fn();
    render(<Composer lang="ko-KR" strings={stringsFor("ko-KR")} onSend={onSend} />);
    const input = screen.getByPlaceholderText("내용을 입력하세요") as HTMLInputElement;
    const form = input.closest("form")!;

    fireEvent.change(input, { target: { value: "여권을 보여 주세요" } });
    fireEvent.submit(form);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("여권을 보여 주세요");

    fireEvent.submit(form);
    expect(onSend).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: "체류카드도 보여 주세요" } });
    fireEvent.submit(form);
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenLastCalledWith("체류카드도 보여 주세요", "text");
  });

  it("does not submit while a Korean IME composition is being committed", () => {
    const onSend = vi.fn();
    render(<Composer lang="ko-KR" strings={stringsFor("ko-KR")} onSend={onSend} />);
    const input = screen.getByPlaceholderText("내용을 입력하세요") as HTMLInputElement;
    const form = input.closest("form")!;

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "안녕하세요" } });
    fireEvent.submit(form);
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input);
    fireEvent.submit(form);
    expect(onSend).toHaveBeenCalledWith("안녕하세요", "text");
  });
});
