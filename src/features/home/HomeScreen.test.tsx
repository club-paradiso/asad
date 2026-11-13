import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { COUNTER_PREFERENCES_STORAGE_KEY } from "@/features/counter/preferences";
import { HomeScreen } from "./HomeScreen";

beforeEach(() => {
  window.localStorage.clear();
});

describe("HomeScreen", () => {
  it("puts the actual brand and working routes before synthetic UI decoration", () => {
    render(<HomeScreen />);

    expect(screen.getByRole("heading", { level: 1, name: /아무튼서로알아들었으면/ })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "방문객과 대화 시작" })[0].getAttribute("href")).toBe("/counter");
    expect(screen.getByRole("link", { name: "실시간 통역 보조" }).getAttribute("href")).toBe("/live");
    expect(document.querySelector("#modes a")?.getAttribute("href")).toBe("/counter");
    expect(screen.getByRole("heading", { level: 2, name: /각자 자기 언어로/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /이어폰으로 듣고 싶을 때/ }).getAttribute("href")).toBe("/listen");
    expect(screen.getByText(/반드시 사람이 확인하세요/)).toBeTruthy();
    expect(screen.queryByText("SIGNAL STUDIO")).toBeNull();
    expect(screen.queryByText("DEMO / NOT LIVE")).toBeNull();
    expect(screen.queryByRole("group", { name: "통역 시나리오 미리보기" })).toBeNull();
  });

  it("retains direct routes to preparation, equipment check, and sessions", () => {
    render(<HomeScreen />);

    const links = screen.getAllByRole("link");
    for (const href of ["/prep", "/booth-preflight", "/sessions"]) {
      expect(links.some((link) => link.getAttribute("href") === href)).toBe(true);
    }
  });

  it("persists the selected language for Counter Mode", () => {
    render(<HomeScreen />);

    const picker = screen.getByRole("combobox", { name: "기본 언어 선택" }) as HTMLSelectElement;
    expect(picker.value).toBe("ko-KR");

    fireEvent.change(picker, { target: { value: "fr-FR" } });

    expect(picker.value).toBe("fr-FR");
    expect(
      screen.getByText("1:1 대화 통역의 직원 언어: 프랑스어 · 발표 통역 언어는 통역 보조 화면에서 선택"),
    ).toBeTruthy();

    expect(JSON.parse(window.localStorage.getItem(COUNTER_PREFERENCES_STORAGE_KEY) ?? "{}"))
      .toMatchObject({ hostLang: "fr-FR" });
  });
});
