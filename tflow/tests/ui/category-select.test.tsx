import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CategorySelect } from "../../app/ui/category-select";
import { Modal } from "../../app/ui/dialog";
import { CATEGORY_GROUPS } from "../../lib/types";

describe("компактный выбор категории", () => {
  it("начинает с шести направлений и показывает категории только выбранного направления", async () => {
    const user = userEvent.setup();
    render(<CategorySelect allowAll />);
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Категория Все категории" }));
    const panel = screen.getByRole("dialog", { name: "Выбор категории" });
    for (const group of CATEGORY_GROUPS) expect(within(panel).getByRole("button", { name: group.name })).toBeVisible();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Технологии" }));
    expect(screen.getAllByRole("option")).toHaveLength(5);
    expect(screen.getByRole("option", { name: "Разработка" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Музыка" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Все направления" }));
    expect(within(panel).getByRole("button", { name: "Культура и творчество" })).toBeVisible();
  });

  it.each(["нейросети", "ИИ", "ai"])("находит категорию по запросу %s и передаёт её в настоящие данные формы", async (query) => {
    const user = userEvent.setup(), onChange = vi.fn();
    const { container } = render(<form><CategorySelect onChange={onChange} /></form>);
    await user.click(screen.getByRole("button", { name: "Категория Выберите категорию" }));
    await user.type(screen.getByRole("combobox", { name: "Поиск категории" }), query);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("Искусственный интеллект");
    expect(new FormData(container.querySelector("form")!).get("topic")).toBe("Искусственный интеллект");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Категория Искусственный интеллект" })).toHaveFocus();
  });

  it("Escape закрывает только выбор категории внутри формы и сохраняет прежнее значение", async () => {
    const user = userEvent.setup(), onClose = vi.fn();
    render(<Modal title="Создать событие" onClose={onClose}><CategorySelect defaultValue="Музыка" /></Modal>);
    await user.click(screen.getByRole("button", { name: "Категория Музыка" }));
    await user.type(screen.getByRole("combobox", { name: "Поиск категории" }), "несуществующая тема");
    expect(screen.getByText(/Ничего не найдено/)).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Выбор категории" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Создать событие" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Категория Музыка" })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("сбрасывает управляемый фильтр и сохраняет старые категории при редактировании", async () => {
    const user = userEvent.setup(), onChange = vi.fn();
    const { rerender, container } = render(<form><CategorySelect value="Старая категория" onChange={onChange} allowAll /></form>);
    expect(new FormData(container.querySelector("form")!).get("topic")).toBe("Старая категория");
    await user.click(screen.getByRole("button", { name: "Категория Старая категория" }));
    await user.click(screen.getByRole("button", { name: "Все категории" }));
    expect(onChange).toHaveBeenCalledWith("");
    rerender(<form><CategorySelect value="" onChange={onChange} allowAll /></form>);
    expect(screen.getByRole("button", { name: "Категория Все категории" })).toBeVisible();
    expect(new FormData(container.querySelector("form")!).get("topic")).toBe("");
  });

  it("не пропускает обязательную категорию и открывает поиск вместо скрытого поля", async () => {
    const user = userEvent.setup(), onSubmit = vi.fn();
    render(<form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><CategorySelect /><button type="submit">Сохранить</button></form>);
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Выберите категорию");
    expect(screen.getByRole("combobox", { name: "Поиск категории" })).toHaveFocus();
  });

  it("на сенсорном устройстве открывает направления без фокуса в поле и выбора клавиатуры", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const user = userEvent.setup();
    render(<CategorySelect allowAll />);
    await user.click(screen.getByRole("button", { name: "Категория Все категории" }));
    expect(screen.getByRole("dialog", { name: "Выбор категории" })).toHaveFocus();
    expect(screen.getByRole("combobox", { name: "Поиск категории" })).not.toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Культура и творчество" }));
    expect(screen.getByRole("option", { name: "Музыка" })).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Выбор категории" })).toHaveFocus();
  });
});
