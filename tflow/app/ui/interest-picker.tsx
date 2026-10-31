import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { CATEGORY_GROUPS } from "../../lib/types";
import { parseInterests } from "../../lib/interests";
import { interestMatches } from "../../public/interest-search.js";
import "../../public/interest-picker.css";

export function InterestPicker({ value, disabled = false }: { value: string; disabled?: boolean }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [selected, setSelected] = useState(() => parseInterests(value));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = CATEGORY_GROUPS.flatMap(group => group.categories
    .filter(category => !selected.includes(category) && interestMatches(category, group.name, query))
    .map(category => ({ category, group: group.name })));
  const expanded = open && !!query.trim() && !disabled;

  useEffect(() => {
    if (expanded && active >= 0) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, expanded]);

  function select(category: string) {
    setSelected(current => current.includes(category) ? current : [...current, category]);
    setQuery(""); setOpen(false); setActive(-1); input.current?.focus();
  }

  return <fieldset className="interest-picker" disabled={disabled}>
    <legend><label htmlFor={id}>Интересы</label></legend>
    <p id={`${id}-help`}>Начните вводить тему и выберите категорию из подсказок. Можно добавить несколько.</p>
    <div className="interest-autocomplete">
      <div className="interest-search-anchor">
        <div className="interest-control">
          <Search size={18} aria-hidden="true" />
          <input ref={input} id={id} role="combobox" autoComplete="off" aria-autocomplete="list"
            aria-expanded={expanded} aria-controls={`${id}-list`} aria-describedby={`${id}-help ${id}-status`}
            aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
            placeholder="Например, музыка или дизайн" value={query}
            onFocus={() => setOpen(true)} onBlur={() => { setOpen(false); setActive(-1); }}
            onChange={event => { setQuery(event.target.value); setOpen(true); setActive(-1); }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault(); setOpen(true);
                if (matches.length) setActive(index => event.key === "ArrowDown" ? (index + 1) % matches.length : (index <= 0 ? matches.length - 1 : index - 1));
              } else if (event.key === "Enter" && query.trim()) {
                event.preventDefault();
                if (expanded && matches.length) select(matches[Math.max(active, 0)].category);
              } else if (event.key === "Escape" && expanded) {
                event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1);
              }
            }} />
          {query && <button type="button" className="interest-clear" aria-label="Очистить поиск интересов"
            onMouseDown={event => event.preventDefault()} onClick={() => { setQuery(""); setOpen(false); setActive(-1); input.current?.focus(); }}><X size={16} /></button>}
        </div>
        {expanded && <div className="interest-dropdown">
          <ul ref={list} className="interest-results" id={`${id}-list`} role="listbox" aria-label="Категории интересов">
            {matches.map(({ category, group }, index) => <li key={category} id={`${id}-option-${index}`} role="option"
              aria-selected={active === index} className={`interest-result${active === index ? " active" : ""}`}
              onMouseDown={event => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => select(category)}>
              <span>{category}<small>{group}</small></span><b aria-hidden="true">+</b>
            </li>)}
          </ul>
          {!matches.length && <p className="interest-empty" role="status">Нет новых категорий по этому запросу. Попробуйте другую тему.</p>}
        </div>}
      </div>
      <ul className="interest-tags" aria-label="Выбранные интересы">
        {selected.map(category => <li key={category}>
          <input type="hidden" name="interests" value={category} />
          <button type="button" className="interest-tag" aria-label={`Удалить интерес «${category}»`}
            onClick={() => { setSelected(current => current.filter(item => item !== category)); setActive(-1); input.current?.focus(); }}>
            <span>{category}</span><span aria-hidden="true">×</span>
          </button>
        </li>)}
      </ul>
      <p className="interest-status" id={`${id}-status`} role="status">{selected.length ? `Выбрано: ${selected.length}. Можно добавить ещё.` : "Необязательно — можно заполнить позже."}</p>
    </div>
  </fieldset>;
}
