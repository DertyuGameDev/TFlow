import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Search } from "lucide-react";
import { CATEGORY_GROUPS, TOPICS } from "../../lib/types";
import { interestMatches } from "../../public/interest-search.js";
import "../category-select.css";

export function CategorySelect({
  value,
  defaultValue,
  onChange,
  allowAll = false,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  allowAll?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const [selected, setSelected] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [invalid, setInvalid] = useState(false);
  const current = value ?? selected;
  const browsing = !!query.trim() || group !== null;
  const matches = CATEGORY_GROUPS.flatMap((item) => item.categories
    .filter((category) => query.trim()
      ? interestMatches(category, item.name, query)
      : item.name === group)
    .map((category) => ({ category, group: item.name })));

  useEffect(() => {
    if (!open) return;
    focusPanel();
    panel.current?.scrollIntoView({ block: "nearest" });
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    if (active >= 0) results.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function focusPanel() {
    // Touch users can browse directions without opening the software keyboard.
    if (window.matchMedia?.("(pointer: coarse)")?.matches) panel.current?.focus({ preventScroll: true });
    else search.current?.focus();
  }

  function show() {
    setQuery("");
    setGroup(null);
    setActive(-1);
    setOpen(true);
  }
  function choose(next: string) {
    setSelected(next);
    onChange?.(next);
    setInvalid(false);
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="category-select" ref={root}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}>
      <label id={`${id}-label`} htmlFor={id}>Категория</label>
      <button id={id} ref={trigger} type="button" className="category-trigger"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-panel`}
        aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined}
        onClick={() => open ? setOpen(false) : show()}>
        <span id={`${id}-value`} className={!current && !allowAll ? "category-placeholder" : undefined}>
          {current || (allowAll ? "Все категории" : "Выберите категорию")}
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {/* Keep native form submission, required validation and older category values. */}
      <select
        className="category-native-value"
        aria-hidden="true"
        tabIndex={-1}
        name="topic"
        required={!allowAll}
        value={current}
        onChange={(event) => choose(event.target.value)}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          show();
          focusPanel();
        }}
      >
        <option value="" />
        {current && !TOPICS.includes(current) && (
          <option value={current}>{current}</option>
        )}
        {TOPICS.map((category) => <option key={category} value={category}>{category}</option>)}
      </select>
      {invalid && <small className="category-error" id={`${id}-error`} role="alert">Выберите категорию события.</small>}
      {open && <div id={`${id}-panel`} ref={panel} tabIndex={-1} className="category-panel" role="dialog" aria-label="Выбор категории">
        <div className="category-search">
          <Search size={17} aria-hidden="true" />
          <input ref={search} type="search" role="combobox" aria-label="Поиск категории"
            autoComplete="off" placeholder="Найти тему или интерес"
            aria-autocomplete="list" aria-expanded={browsing} aria-controls={`${id}-results`}
            aria-activedescendant={browsing && active >= 0 ? `${id}-option-${active}` : undefined}
            value={query} onChange={(event) => { setQuery(event.target.value); setActive(-1); }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length) {
                event.preventDefault();
                setActive((index) => event.key === "ArrowDown" ? (index + 1) % matches.length : (index <= 0 ? matches.length - 1 : index - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (matches.length) choose(matches[Math.max(active, 0)].category);
              }
            }} />
        </div>
        {allowAll && <button type="button" className="category-all" onClick={() => choose("")}>
          Все категории{!current && <Check size={16} aria-hidden="true" />}
        </button>}
        {group && !query.trim() && <button type="button" className="category-back"
          onClick={() => { setGroup(null); setActive(-1); focusPanel(); }}>
          <ArrowLeft size={15} aria-hidden="true" />Все направления
        </button>}
        <div className="category-panel-body">
          {!browsing && <>
            <p className="category-panel-hint">Или выберите направление</p>
            <div className="category-directions">
              {CATEGORY_GROUPS.map((item) => <button type="button" key={item.name}
                onClick={() => { setGroup(item.name); setActive(-1); focusPanel(); }}>
                <span>{item.name}</span><ChevronRight size={15} aria-hidden="true" />
              </button>)}
            </div>
          </>}
          {browsing && <>
            <p className="category-panel-hint" role="status">{query.trim() ? `Найдено: ${matches.length}` : group}</p>
            {!matches.length && <p className="category-empty" role="status">Ничего не найдено. Попробуйте другую тему или название направления.</p>}
          </>}
          <ul ref={results} id={`${id}-results`} role="listbox" aria-label="Категории" hidden={!browsing} className="category-results">
            {matches.map((item, index) => <li key={item.category} role="presentation">
              <button type="button" role="option" id={`${id}-option-${index}`} aria-selected={current === item.category}
                className={active === index ? "category-option is-active" : "category-option"}
                onPointerDown={(event) => event.preventDefault()} onClick={() => choose(item.category)}>
                <span>{item.category}{query.trim() && <small>{item.group}</small>}</span>
                {current === item.category && <Check size={17} aria-hidden="true" />}
              </button>
            </li>)}
          </ul>
        </div>
      </div>}
    </div>
  );
}
