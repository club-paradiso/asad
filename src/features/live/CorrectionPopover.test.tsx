import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CorrectionPopover } from "./CorrectionPopover";

afterEach(cleanup);

const setup = (overrides: Partial<Parameters<typeof CorrectionPopover>[0]> = {}) => {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  render(
    <CorrectionPopover
      open
      heard="유정길 목사입니다"
      defaultRemember
      onApply={onApply}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onApply, onCancel };
};

describe("CorrectionPopover", () => {
  it("is a modal dialog prefilled with what was heard", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect((screen.getByLabelText("Heard") as HTMLInputElement).value).toBe("유정길 목사입니다");
    expect(document.activeElement).toBe(screen.getByLabelText("Correct to"));
  });

  it("applies from → to with the remember choice and a suggested romanisation", () => {
    const { onApply } = setup();
    fireEvent.change(screen.getByLabelText("Heard"), { target: { value: "유정길" } });
    fireEvent.change(screen.getByLabelText("Correct to"), { target: { value: "류정길" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const submitted = onApply.mock.calls[0][0];
    expect(submitted).toMatchObject({ from: "유정길", to: "류정길", remember: true });
    expect(typeof submitted.english).toBe("string");
    expect(submitted.english.length).toBeGreaterThan(0);
  });

  it("lets the interpreter override the translation and the remember flag", () => {
    const { onApply } = setup({ defaultRemember: false });
    fireEvent.change(screen.getByLabelText("Correct to"), { target: { value: "류정길 목사입니다" } });
    fireEvent.change(screen.getByLabelText("Translation"), { target: { value: "Pastor Ryu" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "다음 세션에도 기억" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith({
      from: "유정길 목사입니다",
      to: "류정길 목사입니다",
      english: "Pastor Ryu",
      remember: true,
    });
  });

  it("refuses an empty or unchanged correction", () => {
    const { onApply } = setup();
    const apply = screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Correct to"), { target: { value: "유정길 목사입니다" } });
    expect(apply.disabled).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("cancels on Escape without applying", () => {
    const { onApply, onCancel } = setup();
    fireEvent.change(screen.getByLabelText("Correct to"), { target: { value: "류정길" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("cancels from the button", () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps focus inside while open", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    fireEvent.change(screen.getByLabelText("Correct to"), { target: { value: "류정길" } });

    // Tab from the last control wraps to the first…
    screen.getByRole("button", { name: "Apply" }).focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("Heard"));

    // …and Shift+Tab from the first wraps to the last.
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Apply" }));
  });

  it("renders nothing while closed", () => {
    render(
      <CorrectionPopover open={false} heard="" defaultRemember onApply={() => {}} onCancel={() => {}} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
