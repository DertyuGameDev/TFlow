import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { CATEGORY_GROUPS, TOPICS } from "../../lib/types";
import { interestMatches } from "../../public/interest-search.js";
import "../category-select.css";

const categories = CATEGORY_GROUPS.flatMap(group => group.categories.map(category => ({ category, group: group.name })));
const suggestions = CATEGORY_GROUPS.map(group => group.categories[0]);

export function CategorySelect({ value, defaultValue, onChange, allowAll = false }: {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  allowAll?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const control = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [selected, setSelected] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [invalid, setInvalid] = useState(false);
  const [placement, setPlacement] = useState({ above: false, height: 240 });
  const current = value ?? selected;
  const searching = open && !!query.trim();
  const matches = searching
    ? categories.filter(item => interestMatches(item.category, item.group, query))
    : [...new Set([current, ...suggestions].filter(Boolean))].slice(0, 5).map(category => ({ category, group: "" }));
  const options = allowAll && !searching
    ? current ? [...matches, { category: "", group: "" }] : [{ category: "", group: "" }, ...matches]
    : matches;

  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      const rect = control.current?.getBoundingClientRect();
      if (!rect) return;
      const dialog = root.current?.closest("dialog")?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const nav = document.querySelector<HTMLElement>(".mobile-bottom-nav");
      const header = document.querySelector<HTMLElement>(".flow-topbar");
      const top = Math.max(viewportTop, dialog?.top ?? header?.getBoundingClientRect().bottom ?? viewportTop) + 8;
      const bottom = Math.min(viewportBottom, dialog?.bottom ?? (nav?.offsetHeight ? nav.getBoundingClientRect().top : viewportBottom)) - 8;
      const below = Math.max(0, bottom - rect.bottom - 6);
      const above = Math.max(0, rect.top - top - 6);
      const flip = below < 200 && above > below;
      const height = Math.max(44, Math.floor(Math.min(240, flip ? above : below)));
      setPlacement(previous => previous.above === flip && previous.height === height ? previous : { above: flip, height });
    }
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  useEffect(() => {
    if (!open && document.activeElement === input.current) input.current?.select();
  }, [open, current]);

  function show() { setQuery(""); setActive(-1); setOpen(true); }
  function choose(next: string) {
    setSelected(next);
    onChange?.(next);
    setInvalid(false);
    setQuery("");
    setActive(-1);
    if (window.matchMedia?.("(pointer: coarse)")?.matches) input.current?.blur();
    else if (document.activeElement !== input.current) input.current?.focus({ preventScroll: true });
    setOpen(false);
  }

  return <div className="category-select" ref={root}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    onKeyDown={event => {
      if (event.key === "Escape" && open) {
        event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1);
      }
    }}>
    <label htmlFor={id}>Категория</label>
    <div className="category-control" ref={control}>
      <Search className="category-search-icon" size={18} aria-hidden="true" />
      <input ref={input} id={id} role="combobox" aria-label="Категория" autoComplete="off"
        aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-results`}
        aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined}
        aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined}
        placeholder={open ? "Название или интерес" : allowAll ? "Все категории" : "Найдите категорию"}
        value={open ? query : current} onFocus={show} onClick={() => { if (!open) show(); }}
        onChange={event => { setQuery(event.target.value); setActive(-1); setOpen(true); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) { show(); setActive(event.key === "ArrowDown" ? 0 : options.length - 1); }
            else if (options.length) setActive(index => event.key === "ArrowDown" ? (index + 1) % options.length : index <= 0 ? options.length - 1 : index - 1);
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            if (options.length) choose(options[Math.max(0, active)].category);
          }
        }} />
      {current ? <button type="button" className="category-field-action" aria-label="Сбросить категорию"
        onMouseDown={event => event.preventDefault()} onClick={() => choose("")}><X size={18} /></button>
        : <button type="button" className="category-field-action" aria-label={open ? "Закрыть категории" : "Показать категории"}
          onMouseDown={event => event.preventDefault()} onClick={() => open ? setOpen(false) : show()}><ChevronDown size={18} /></button>}
      {open && <div className={`category-menu ${placement.above ? "category-menu-above" : ""}`} style={{ maxHeight: placement.height }}>
        <ul ref={list} id={`${id}-results`} role="listbox" aria-label="Категории" className="category-results">
          {options.map((item, index) => <li key={item.category} role="presentation">
            <button type="button" role="option" tabIndex={-1} id={`${id}-option-${index}`} aria-selected={current === item.category}
              className={`category-option ${active === index ? "is-active" : ""}`}
              onMouseDown={event => event.preventDefault()} onClick={() => choose(item.category)}>
              <span>{item.category || "Все категории"}</span>{current === item.category && <Check size={17} aria-hidden="true" />}
            </button>
          </li>)}
        </ul>
        {!options.length && <p className="category-empty" role="status">Ничего не найдено. Попробуйте другое название.</p>}
        {!searching && placement.height >= 120 && <p className="category-menu-hint">Введите название — поиск по всем категориям</p>}
      </div>}
    </div>
    {/* Native form values and validation stay independent of the search draft. */}
    <select className="category-native-value" aria-hidden="true" tabIndex={-1} name="topic" required={!allowAll} value={current}
      onChange={event => choose(event.target.value)} onInvalid={event => { event.preventDefault(); setInvalid(true); show(); input.current?.focus(); }}>
      <option value="" />
      {current && !TOPICS.includes(current) && <option value={current}>{current}</option>}
      {TOPICS.map(category => <option key={category} value={category}>{category}</option>)}
    </select>
    {invalid && <small className="category-error" id={`${id}-error`} role="alert">Выберите категорию события из подсказок.</small>}
  </div>;
}
