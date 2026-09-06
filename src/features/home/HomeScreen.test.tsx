import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { COUNTER_PREFERENCES_STORAGE_KEY } from "@/features/counter/preferences";
import { HomeScreen } from "./HomeScreen";

beforeEach(() => {
  window.localStorage.clear();
});

describe("HomeScreen default language", () => {
  it("persists the selected language for Counter Mode", () => {
    render(<HomeScreen />);

    const picker = screen.getByRole("combobox", { name: "기본 언어 선택" });
    expect(picker).toHaveValue("ko-KR");

    fireEvent.change(picker, { target: { value: "fr-FR" } });

    expect(picker).toHaveValue("fr-FR");
    expect(screen.getByText("현재 프랑스어로 설정됨 · 라이브 통역은 현재 한국어 → 영어 고정")).toBeTruthy();

    expect(JSON.parse(window.localStorage.getItem(COUNTER_PREFERENCES_STORAGE_KEY) ?? "{}"))
      .toMatchObject({ hostLang: "fr-FR" });
  });
});
