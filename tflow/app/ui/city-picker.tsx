import { useEffect, useId, useRef, useState } from "react";
import { Check, MapPin, X } from "lucide-react";
import { CITY_SUGGESTIONS, cityMatches, normalizeCity } from "../../lib/cities";

type Props = {
  defaultValue?: string; value?: string; onChange?: (city: string) => void;
  cities?: readonly string[]; required?: boolean; disabled?: boolean; error?: string;
};

export function CityPicker({defaultValue = "", value, onChange, cities = CITY_SUGGESTIONS, required = true, disabled = false, error}: Props) {
  const id = useId(), input = useRef<HTMLInputElement>(null), list = useRef<HTMLUListElement>(null);
  const [draft, setDraft] = useState(defaultValue), [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const [above, setAbove] = useState(false);
  const current = value ?? draft;
  const choices = defaultValue ? [...cities, defaultValue] : cities;
  const matches = cityMatches(current, choices);
  const expanded = open && !disabled;

  function change(next: string) {setDraft(next); onChange?.(next); setActive(-1);}
  function select(city: string) {change(city); setOpen(false); input.current?.focus();}
  function show() {
    const rect = input.current?.getBoundingClientRect(), dialog = input.current?.closest("dialog")?.getBoundingClientRect();
    if (rect) {
      const viewportBottom = window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight;
      const below = Math.min(viewportBottom, dialog?.bottom ?? viewportBottom) - rect.bottom;
      const roomAbove = rect.top - Math.max(window.visualViewport?.offsetTop ?? 0, dialog?.top ?? 0);
      setAbove(below < 240 && roomAbove > below);
    }
    setOpen(true);
  }
  useEffect(() => {
    if (expanded && active >= 0) list.current?.children[active]?.scrollIntoView({block: "nearest"});
  }, [active, expanded]);

  return <div className="city-field">
    <label htmlFor={id}>Город</label>
    <div className="city-control">
      <MapPin className="city-input-icon" size={17} aria-hidden="true"/>
      <input ref={input} id={id} name="city" role="combobox" aria-autocomplete="list" aria-expanded={expanded}
        aria-controls={`${id}-list`} aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
        aria-invalid={error?true:undefined} aria-describedby={error?`${id}-error`:undefined}
        placeholder="Начните вводить город" autoComplete="off"
        required={required} disabled={disabled} value={current}
        onFocus={show}
        onChange={event => {change(event.target.value); show();}}
        onBlur={() => {
          setOpen(false); setActive(-1);
          const exact = choices.find(city => normalizeCity(city) === normalizeCity(current));
          if (exact && exact !== current) change(exact);
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); show();
            if (matches.length) setActive(index => event.key === "ArrowDown" ? (index + 1) % matches.length : (index <= 0 ? matches.length - 1 : index - 1));
          } else if (event.key === "Enter" && expanded && active >= 0 && matches[active]) {
            event.preventDefault(); select(matches[active]);
          } else if (event.key === "Escape" && expanded) {
            event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1);
          }
        }}/>
      {current && !disabled && <button className="city-clear" type="button" aria-label="Очистить город" onPointerDown={event => event.preventDefault()} onClick={() => {change(""); input.current?.focus(); show();}}><X size={16}/></button>}
      {expanded && <div className={`city-dropdown ${above ? "city-dropdown-above" : ""}`}>
        <ul id={`${id}-list`} className="city-options" ref={list} role="listbox" aria-label="Варианты городов">
          {matches.map((city, index) => <li id={`${id}-option-${index}`} role="option" aria-selected={active === index}
            className={active === index ? "city-option active" : "city-option"} key={city}
            onPointerDown={event => event.preventDefault()} onClick={() => select(city)} onPointerMove={() => setActive(index)}>
            <MapPin size={15} aria-hidden="true"/><span>{city}</span>{normalizeCity(city) === normalizeCity(current) && <Check size={15} aria-hidden="true"/>}
          </li>)}
        </ul>
        {!matches.length && <p className="city-no-results" role="status">Совпадений нет. Можно указать свой город.</p>}
      </div>}
    </div>
    {error&&<span className="profile-field-error" id={`${id}-error`}>{error}</span>}
  </div>;
}
