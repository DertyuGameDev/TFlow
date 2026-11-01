import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CategorySelect } from "../../app/ui/category-select";
import { Modal } from "../../app/ui/dialog";
import { TOPICS } from "../../lib/types";

describe("поиск категории", () => {
  it("позволяет найти и выбрать любую категорию из полного каталога", async () => {
    render(<CategorySelect />);
    const field = screen.getByRole("combobox", { name: "Категория" });
    for (const category of TOPICS) {
      fireEvent.change(field, { target: { value: category } });
      await userEvent.click(screen.getByRole("option", { name: category }));
      expect(field).toHaveValue(category);
    }
  });

  it("показывает одно поле и короткие подсказки вместо меню направлений", async () => {
    render(<CategorySelect allowAll />);
    const field = screen.getByRole("combobox", { name: "Категория" });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    await userEvent.click(field);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getAllByRole("option")).toHaveLength(6);
    expect(screen.getByRole("option", { name: "Все категории" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Технологии" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["нейросети", "ИИ", "ai"])("находит категорию по запросу %s и сохраняет выбранное значение в форме", async query => {
    const user = userEvent.setup(), onChange = vi.fn();
    const { container } = render(<form><CategorySelect onChange={onChange} /></form>);
    const field = screen.getByRole("combobox", { name: "Категория" });
    await user.type(field, query);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("Искусственный интеллект");
    expect(new FormData(container.querySelector("form")!).get("topic")).toBe("Искусственный интеллект");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field).toHaveValue("Искусственный интеллект");
    expect(field).toHaveFocus();
  });

  it("находит категории из всего каталога и по названиям направлений", async () => {
    const user = userEvent.setup();
    render(<CategorySelect />);
    const field = screen.getByRole("combobox", { name: "Категория" });
    await user.type(field, "технологии");
    expect(screen.getAllByRole("option")).toHaveLength(5);
    expect(screen.getByRole("option", { name: "Кибербезопасность" })).toBeVisible();
    await user.clear(field);
    await user.type(field, "семья");
    await user.click(screen.getByRole("option", { name: "Семья и дети" }));
    expect(field).toHaveValue("Семья и дети");
  });

  it("Escape закрывает подсказки внутри формы, сохраняя выбор и саму форму", async () => {
    const user = userEvent.setup(), onClose = vi.fn();
    render(<Modal title="Создать событие" onClose={onClose}><CategorySelect defaultValue="Музыка" /></Modal>);
    const field = screen.getByRole("combobox", { name: "Категория" });
    await user.type(field, "несуществующая тема");
    expect(screen.getByText(/Ничего не найдено/)).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Создать событие" })).toBeVisible();
    expect(field).toHaveValue("Музыка");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("передаёт в фильтр только выбранную категорию и позволяет сбросить её", async () => {
    const user = userEvent.setup(), onChange = vi.fn();
    const { rerender, container } = render(<form><CategorySelect value="Старая категория" onChange={onChange} allowAll /></form>);
    const field = screen.getByRole("combobox", { name: "Категория" });
    expect(new FormData(container.querySelector("form")!).get("topic")).toBe("Старая категория");
    await user.type(field, "кино");
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("Кино");
    rerender(<form><CategorySelect value="Кино" onChange={onChange} allowAll /></form>);
    await user.click(screen.getByRole("button", { name: "Сбросить категорию" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    rerender(<form><CategorySelect value="" onChange={onChange} allowAll /></form>);
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", "Все категории");
  });

  it("не сохраняет произвольный текст и возвращает прежний выбор при уходе из поля", async () => {
    const user = userEvent.setup(), onChange = vi.fn();
    const { container } = render(<form><CategorySelect defaultValue="Музыка" onChange={onChange} /><button>Другое поле</button></form>);
    const field = screen.getByRole("combobox", { name: "Категория" });
    await user.type(field, "кино");
    expect(new FormData(container.querySelector("form")!).get("topic")).toBe("Музыка");
    await user.tab();
    await user.tab();
    expect(field).toHaveValue("Музыка");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("проверяет обязательный выбор и фокусирует видимое поле", async () => {
    const user = userEvent.setup(), onSubmit = vi.fn();
    render(<form onSubmit={event => { event.preventDefault(); onSubmit(); }}><CategorySelect /><button type="submit">Сохранить</button></form>);
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Выберите категорию");
    expect(screen.getByRole("combobox", { name: "Категория" })).toHaveFocus();
    expect(screen.getByRole("listbox")).toBeVisible();
  });

  it("на телефоне позволяет открыть подсказки без клавиатуры и не блокирует свайпы списка", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<CategorySelect allowAll />);
    await userEvent.click(screen.getByRole("button", { name: "Показать категории" }));
    expect(screen.getByRole("combobox", { name: "Категория" })).not.toHaveFocus();
    const option = screen.getByRole("option", { name: "Музыка" });
    const touch = new Event("pointerdown", { bubbles: true, cancelable: true });
    fireEvent(option, touch);
    expect(touch.defaultPrevented).toBe(false);
    await userEvent.click(option);
    expect(screen.getByRole("combobox", { name: "Категория" })).toHaveValue("Музыка");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
