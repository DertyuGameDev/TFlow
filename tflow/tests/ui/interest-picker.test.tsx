import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InterestPicker } from "../../app/ui/interest-picker";

describe("поиск интересов", () => {
  it("показывает категории только по запросу и сохраняет выбранные без дублей", async () => {
    const user = userEvent.setup();
    const { container } = render(<form><InterestPicker value="Дизайн" /></form>);
    const input = screen.getByRole("combobox", { name: "Интересы" });
    await user.click(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.type(input, "муз");
    await user.click(screen.getByRole("option", { name: /Музыка/ }));
    expect(input).toHaveValue("");
    expect(new FormData(container.querySelector("form")!).getAll("interests")).toEqual(["Дизайн", "Музыка"]);
    await user.type(input, "муз");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Удалить интерес «Музыка»" }));
    expect(screen.getByRole("option", { name: /Музыка/ })).toBeVisible();
    expect(new FormData(container.querySelector("form")!).getAll("interests")).toEqual(["Дизайн"]);
  });

  it("выбирает клавиатурой, ищет по группе и сокращению, не отправляет форму по Enter", async () => {
    const user = userEvent.setup(), submit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={submit}><InterestPicker value="" /><button type="submit">Готово</button></form>);
    const input = screen.getByRole("combobox");
    await user.type(input, "технологии");
    expect(screen.getAllByRole("option")).toHaveLength(5);
    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    await user.clear(input); await user.type(input, "ии");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByRole("button", { name: "Удалить интерес «Искусственный интеллект»" })).toBeVisible();
    expect(submit).not.toHaveBeenCalled();
    await user.type(input, "неттакойтемы{Enter}");
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText(/Нет новых категорий/)).toBeVisible();
  });

  it("сохраняет прежние интересы и блокирует редактирование во время отправки", () => {
    render(<InterestPicker value="Мой прежний интерес" disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Удалить интерес/ })).toBeDisabled();
  });
});
