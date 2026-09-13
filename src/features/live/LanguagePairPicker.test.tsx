import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguagePairPicker } from "./LanguagePairPicker";

afterEach(cleanup);

describe("LanguagePairPicker", () => {
  it("labels both sides visibly and lists every registry language", () => {
    render(<LanguagePairPicker value={{ source: "ko-KR", target: "en-US" }} onChange={() => {}} />);

    const source = screen.getByLabelText("말하는 언어") as HTMLSelectElement;
    const target = screen.getByLabelText("통역할 언어") as HTMLSelectElement;
    expect(source.value).toBe("ko-KR");
    expect(target.value).toBe("en-US");
    expect(source.options.length).toBeGreaterThan(20);
    expect(Array.from(source.options).map((option) => option.textContent)).toContain(
      "중국어(번체) · 中文（繁體）",
    );
  });

  it("swaps the sides and keeps them distinct", () => {
    const onChange = vi.fn();
    render(<LanguagePairPicker value={{ source: "ko-KR", target: "ja-JP" }} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "언어 방향 바꾸기" }));
    expect(onChange).toHaveBeenCalledWith({ source: "ja-JP", target: "ko-KR" });
  });

  it("emits canonical ids and never the same language on both sides", () => {
    const onChange = vi.fn();
    render(<LanguagePairPicker value={{ source: "ko", target: "en-GB" }} onChange={onChange} />);

    // Aliases resolve before anything is shown.
    expect((screen.getByLabelText("말하는 언어") as HTMLSelectElement).value).toBe("ko-KR");
    expect((screen.getByLabelText("통역할 언어") as HTMLSelectElement).value).toBe("en-US");

    fireEvent.change(screen.getByLabelText("통역할 언어"), { target: { value: "zh-TW" } });
    expect(onChange).toHaveBeenLastCalledWith({ source: "ko-KR", target: "zh-TW" });

    // Choosing the language already on the other side turns the pair around.
    fireEvent.change(screen.getByLabelText("말하는 언어"), { target: { value: "en-US" } });
    expect(onChange).toHaveBeenLastCalledWith({ source: "en-US", target: "ko-KR" });
  });

  it("gives the swap a 44px target", () => {
    render(<LanguagePairPicker value={{ source: "ko-KR", target: "en-US" }} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "언어 방향 바꾸기" }).className).toMatch(/size-11/);
  });
});
