import { interestMatches } from "./interest-search.js";

export function setupInterestPicker(root) {
  const source = root.querySelector("[data-interest-source]");
  const search = root.querySelector("[data-interest-search]");
  const input = search.querySelector("input");
  const clear = search.querySelector(".interest-clear");
  const dropdown = search.querySelector(".interest-dropdown");
  const list = search.querySelector(".interest-results");
  const empty = search.querySelector(".interest-empty");
  const tags = search.querySelector(".interest-tags");
  const status = search.querySelector(".interest-status");
  const choices = [...source.querySelectorAll("input[type=checkbox]")].map(checkbox => ({
    checkbox,
    category: checkbox.value,
    group: checkbox.closest(".interest-choice-group").querySelector(".interest-group-title").textContent.trim(),
  }));
  let active = -1;
  let matches = [];

  function close() {
    dropdown.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }
  function highlight(index) {
    active = index;
    [...list.children].forEach((item, i) => {
      item.classList.toggle("active", i === active);
      item.setAttribute("aria-selected", String(i === active));
    });
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", list.children[active].id);
      list.children[active].scrollIntoView({ block: "nearest" });
    }
  }
  function renderTags() {
    tags.replaceChildren();
    const selected = choices.filter(item => item.checkbox.checked);
    selected.forEach(({ checkbox, category }) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "interest-tag";
      button.setAttribute("aria-label", `Удалить интерес «${category}»`);
      const label = document.createElement("span");
      label.textContent = category;
      const cross = document.createElement("span");
      cross.textContent = "×";
      cross.setAttribute("aria-hidden", "true");
      button.append(label, cross);
      button.addEventListener("click", () => {
        checkbox.checked = false;
        renderTags(); input.focus(); renderResults();
      });
      li.append(button); tags.append(li);
    });
    status.textContent = selected.length ? `Выбрано: ${selected.length}. Можно добавить ещё.` : "Необязательно — можно заполнить позже.";
  }
  function select(item) {
    item.checkbox.checked = true;
    input.value = "";
    clear.hidden = true;
    renderTags(); close(); input.focus();
  }
  function renderResults() {
    close(); list.replaceChildren();
    clear.hidden = !input.value;
    if (!input.value.trim()) return;
    matches = choices.filter(item => !item.checkbox.checked && interestMatches(item.category, item.group, input.value));
    matches.forEach((item, index) => {
      const option = document.createElement("li");
      option.id = `${list.id}-${index}`;
      option.className = "interest-result";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      const label = document.createElement("span");
      label.textContent = item.category;
      const group = document.createElement("small");
      group.textContent = item.group; label.append(group);
      const plus = document.createElement("b");
      plus.textContent = "+"; plus.setAttribute("aria-hidden", "true");
      option.append(label, plus);
      option.addEventListener("mousedown", event => event.preventDefault());
      option.addEventListener("mousemove", () => highlight(index));
      option.addEventListener("click", () => select(item));
      list.append(option);
    });
    empty.hidden = !!matches.length;
    dropdown.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  input.addEventListener("input", renderResults);
  input.addEventListener("focus", renderResults);
  input.addEventListener("blur", close);
  input.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (dropdown.hidden) renderResults();
      if (matches.length && !dropdown.hidden) highlight(event.key === "ArrowDown" ? (active + 1) % matches.length : (active <= 0 ? matches.length - 1 : active - 1));
    } else if (event.key === "Enter" && input.value.trim()) {
      event.preventDefault();
      if (!dropdown.hidden && matches.length) select(matches[Math.max(active, 0)]);
    } else if (event.key === "Escape" && !dropdown.hidden) {
      event.preventDefault(); event.stopPropagation(); close();
    }
  });
  clear.addEventListener("mousedown", event => event.preventDefault());
  clear.addEventListener("click", () => { input.value = ""; input.focus(); renderResults(); });
  root.closest("form")?.addEventListener("reset", () => {
    queueMicrotask(() => { input.value = ""; renderTags(); renderResults(); close(); });
  });
  renderTags(); source.hidden = true; search.hidden = false;
}

document.querySelectorAll("[data-interest-picker]").forEach(setupInterestPicker);
