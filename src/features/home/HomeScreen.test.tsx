import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { COUNTER_PREFERENCES_STORAGE_KEY } from "@/features/counter/preferences";
import { HomeScreen } from "./HomeScreen";

beforeEach(() => {
  window.localStorage.clear();
});

describe("HomeScreen", () => {
  it("shows working entry points without presenting the demo as live audio", () => {
    render(<HomeScreen />);

    expect(screen.getByRole("heading", { name: /말은 흘러가도/ })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /라이브 통역 시작/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /현장 응대 시작/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /베타 살펴보기/ })).toBeTruthy();
    expect(screen.getByText("DEMO / NOT LIVE")).toBeTruthy();
    expect(screen.getByText(/반드시 사람이 확인하세요/)).toBeTruthy();
  });

  it("lets users explore three illustrated scenes without opening the microphone", () => {
    render(<HomeScreen />);

    const scenePicker = screen.getByRole("group", { name: "통역 시나리오 미리보기" });
    const counter = within(scenePicker).getByRole("button", { name: /일대일 현장 응대/ });
    fireEvent.click(counter);

    expect(counter.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("예약 내역을 함께 확인해 볼게요.")).toBeTruthy();
    expect(screen.getByText("방문자에게 QR 코드 공유")).toBeTruthy();
    expect(screen.getByText("DEMO / NOT LIVE")).toBeTruthy();

    const finderPicker = screen.getByRole("group", { name: "사용 상황 선택" });
    const earbud = within(finderPicker).getByRole("button", { name: /내 귀로 듣고 싶을 때/ });
    fireEvent.click(earbud);

    expect(earbud.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("The meeting will begin in five minutes.")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /이어폰 베타 열기/ }).every((link) => link.getAttribute("href") === "/listen")).toBe(true);
    expect(within(scenePicker).getByRole("button", { name: /이어폰 청취/ }).getAttribute("aria-pressed")).toBe("true");
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
