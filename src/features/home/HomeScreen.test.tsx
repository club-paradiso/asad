import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { COUNTER_PREFERENCES_STORAGE_KEY } from "@/features/counter/preferences";
import { HomeScreen } from "./HomeScreen";

beforeEach(() => {
  window.localStorage.clear();
});

describe("HomeScreen", () => {
  it("shows working entry points without presenting the demo as live audio", () => {
    render(<HomeScreen />);

    expect(screen.getByRole("heading", { name: /말을 듣는 동안/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /라이브 통역 시작/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /현장 응대 시작/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /베타 살펴보기/ })).toBeTruthy();
    expect(screen.getByText("DEMO / NOT LIVE")).toBeTruthy();
    expect(screen.getByText(/반드시 사람이 확인하세요/)).toBeTruthy();
  });

  it("persists the selected language for Counter Mode", () => {
    render(<HomeScreen />);

    const picker = screen.getByRole("combobox", { name: "기본 언어 선택" }) as HTMLSelectElement;
    expect(picker.value).toBe("ko-KR");

    fireEvent.change(picker, { target: { value: "fr-FR" } });

    expect(picker.value).toBe("fr-FR");
    expect(
      screen.getByText("현재 프랑스어로 설정됨 · 라이브 통역은 현재 한국어 → 영어 고정"),
    ).toBeTruthy();

    expect(JSON.parse(window.localStorage.getItem(COUNTER_PREFERENCES_STORAGE_KEY) ?? "{}"))
      .toMatchObject({ hostLang: "fr-FR" });
  });
});
