import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CityPicker } from "../../app/ui/city-picker";

describe("выбор города", () => {
  it("находит Петербург по сокращению и выбирает с клавиатуры", async () => {
    const user = userEvent.setup(), onChange = vi.fn();
    render(<CityPicker onChange={onChange} cities={["Москва", "Санкт-Петербург", "Мурманск"]} />);
    const input = screen.getByRole("combobox", { name: "Город" });
    await user.type(input, "спб");
    expect(screen.getByRole("option", { name: "Санкт-Петербург" })).toBeVisible();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveValue("Санкт-Петербург");
    expect(onChange).toHaveBeenLastCalledWith("Санкт-Петербург");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("Escape закрывает подсказки, сохраняя неизвестный город", async () => {
    const user = userEvent.setup();
    render(<CityPicker cities={["Москва"]} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "Новый город");
    expect(screen.getByRole("status")).toHaveTextContent("Можно указать свой город");
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("Новый город");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("нормализует ё и дефисы и сохраняет собственный город из старого профиля", async () => {
    const user = userEvent.setup();
    render(<CityPicker defaultValue="Орёл" cities={["Москва"]} />);
    const input = screen.getByRole("combobox");
    await user.clear(input); await user.type(input, "орел"); await user.tab();
    expect(input).toHaveValue("Орёл");
  });

  it("очистка возвращает фокус, а заблокированное поле не меняет значение", async () => {
    const user = userEvent.setup(), onChange = vi.fn();
    const view = render(<CityPicker defaultValue="Москва" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Очистить город" }));
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.getByRole("combobox")).toHaveFocus();
    view.rerender(<CityPicker value="Казань" onChange={onChange} disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("combobox")).toHaveValue("Казань");
    expect(screen.queryByRole("button", { name: "Очистить город" })).not.toBeInTheDocument();
  });
});
