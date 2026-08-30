import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RescueControl } from "./RescueControl";

describe("RescueControl", () => {
  it("fires Rescue from the R shortcut outside editable controls", () => {
    const onTrigger = vi.fn();
    render(
      <RescueControl
        state={{ phase: "idle", chunks: [] }}
        onTrigger={onTrigger}
        onClear={() => {}}
      />,
    );

    fireEvent.keyDown(window, { key: "r" });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("does not steal R while the interpreter is typing", () => {
    const onTrigger = vi.fn();
    render(
      <div>
        <input aria-label="Correction input" />
        <RescueControl
          state={{ phase: "idle", chunks: [] }}
          onTrigger={onTrigger}
          onClear={() => {}}
        />
      </div>,
    );

    fireEvent.keyDown(screen.getByLabelText("Correction input"), { key: "r" });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("keeps the emergency bridge separate from ordinary interpretation output", () => {
    render(
      <RescueControl
        state={{
          phase: "showing",
          chunks: ["Stay with the current point.", "God remains faithful."],
          confidence: "high",
        }}
        onTrigger={() => {}}
        onClear={() => {}}
      />,
    );

    expect(screen.getByText("Stay with the current point.")).toBeTruthy();
    expect(screen.getByText("God remains faithful.")).toBeTruthy();
    expect(
      screen.getByText(/Recovery cue only · not added to the normal English stream/i),
    ).toBeTruthy();
  });

  it("disables repeated activation while a Rescue request is already loading", () => {
    const onTrigger = vi.fn();
    render(
      <RescueControl
        state={{ phase: "loading", chunks: [] }}
        onTrigger={onTrigger}
        onClear={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: "Rescuing…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onTrigger).not.toHaveBeenCalled();
  });
});
