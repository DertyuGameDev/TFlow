import { screen } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setupInterestPicker } from "../../public/registration-interests.js";

function registration() {
  document.body.innerHTML = `<form><div data-interest-picker>
    <div data-interest-source><div class="interest-choice-group">
      <span class="interest-group-title">Культура и творчество</span>
      <input type="checkbox" name="interests" value="Музыка" checked>
      <input type="checkbox" name="interests" value="Театр">
    </div></div>
    <div data-interest-search hidden>
      <input role="combobox" aria-label="Найти интерес">
      <button class="interest-clear" type="button">Очистить</button>
      <div class="interest-dropdown" hidden><ul class="interest-results" id="results" role="listbox"></ul>
        <p class="interest-empty" hidden>Нет новых категорий</p></div>
      <ul class="interest-tags"></ul><p class="interest-status" role="status"></p>
    </div>
  </div><button type="submit">Отправить</button></form>`;
  setupInterestPicker(document.querySelector("[data-interest-picker]")!);
  return document.querySelector("form")!;
}

afterEach(() => { document.body.replaceChildren(); });

describe("интересы в регистрации Django", () => {
  it("восстанавливает выбранное и отправляет только выбранные категории после добавления и удаления", async () => {
    const user = userEvent.setup(), form = registration();
    const input = screen.getByRole("combobox");
    expect(screen.getByRole("button", { name: "Удалить интерес «Музыка»" })).toBeVisible();
    await user.type(input, "теат");
    await user.click(screen.getByRole("option", { name: /Театр/ }));
    expect(new FormData(form).getAll("interests")).toEqual(["Музыка", "Театр"]);
    expect(input).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Удалить интерес «Музыка»" }));
    expect(new FormData(form).getAll("interests")).toEqual(["Театр"]);
    await user.type(input, "теат");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByText("Нет новых категорий")).toBeVisible();
  });

  it("выбирает с клавиатуры, закрывает Escape и восстанавливает исходные данные при сбросе", async () => {
    const user = userEvent.setup(), form = registration();
    const input = screen.getByRole("combobox");
    await user.type(input, "культура");
    await user.keyboard("{ArrowDown}{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(new FormData(form).getAll("interests")).toEqual(["Музыка", "Театр"]);
    form.reset();
    await Promise.resolve();
    expect(new FormData(form).getAll("interests")).toEqual(["Музыка"]);
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
});
