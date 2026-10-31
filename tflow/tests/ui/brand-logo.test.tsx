import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BrandLogo } from "../../app/ui/brand-logo";

function theme(value: string) {
  document.documentElement.dataset.theme = value;
  window.dispatchEvent(new Event("tflow-theme-change"));
}
afterEach(() => theme("light"));

describe("контрастный логотип", () => {
  it("при открытии тёмной страницы сразу выбирает белую надпись", () => {
    theme("dark");
    render(<BrandLogo />);
    expect(screen.getByRole("img", { name: "ТФлоу" })).toHaveAttribute("src", "/logo-dark.svg");
  });
  it("переключает изображение вместе с темой без перезагрузки", async () => {
    theme("light"); render(<BrandLogo />);
    const image = screen.getByRole("img", { name: "ТФлоу" });
    expect(image).toHaveAttribute("src", "/logo.svg");
    await act(async () => theme("dark"));
    expect(image).toHaveAttribute("src", "/logo-dark.svg");
    await act(async () => theme("light"));
    expect(image).toHaveAttribute("src", "/logo.svg");
  });
  it("сохраняет компактный щит и не дублирует имя ссылки декоративным изображением", () => {
    const { container } = render(<BrandLogo compactOnNarrow decorative />);
    expect(container.querySelector('source[media="(max-width:350px)"]')).toHaveAttribute("srcset", "/logo-mark.svg");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });
});
