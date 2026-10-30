import { useId, useState } from "react";
import { TOPICS } from "../../lib/types";
import { parseInterests } from "../../lib/interests";

export function InterestPicker({value, disabled = false}: {value: string; disabled?: boolean}) {
  const id = useId();
  const previous = parseInterests(value);
  const [selected, setSelected] = useState(previous);
  // Existing custom interests remain selectable until the user removes them.
  const options = Array.from(new Set([...TOPICS, ...previous]));
  return <fieldset className="interest-picker" disabled={disabled}>
    <legend>Интересы</legend>
    <p id={id}>Выберите несколько категорий — их можно изменить в любой момент.</p>
    <div className="interest-options">{options.map(category => <label className="interest-option" key={category}>
      <input type="checkbox" name="interests" value={category} checked={selected.includes(category)} aria-describedby={id} onChange={event => setSelected(current => event.target.checked ? [...current, category] : current.filter(item => item !== category))}/>
      <span>{category}</span>
    </label>)}</div>
  </fieldset>;
}
