import { useId, useState } from "react";
import { CATEGORY_GROUPS, TOPICS } from "../../lib/types";
import { parseInterests } from "../../lib/interests";

export function InterestPicker({
  value,
  disabled = false,
}: {
  value: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [selected, setSelected] = useState(() => parseInterests(value));
  const [query, setQuery] = useState("");
  const custom = parseInterests(value).filter(
    (category) => !TOPICS.includes(category),
  );
  const groups = [
    ...CATEGORY_GROUPS,
    ...(custom.length
      ? [{ name: "Ваши прежние интересы", categories: custom }]
      : []),
  ];
  const normalize = (text: string) =>
    text.toLocaleLowerCase("ru").replaceAll("ё", "е");
  const visible = groups
    .map((group) => ({
      ...group,
      categories: group.categories.filter((category) =>
        normalize(`${group.name} ${category}`).includes(
          normalize(query.trim()),
        ),
      ),
    }))
    .filter((group) => group.categories.length);
  return (
    <fieldset className="interest-picker" disabled={disabled}>
      <legend>Интересы</legend>
      <p id={id}>Выберите темы, которые вам близки. Это необязательно.</p>
      <label className="interest-search">
        Найти интерес
        <input
          type="search"
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          value={query}
          placeholder="Например, музыка или спорт"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p className="interest-selection-count" role="status">
        Выбрано: {selected.length}
      </p>
      {selected.map((category) => (
        <input key={category} type="hidden" name="interests" value={category} />
      ))}
      <div className="interest-group-list">
        {visible.map((group) => (
          <div className="interest-category-group" key={group.name}>
            <h3>{group.name}</h3>
            <div className="interest-options">
              {group.categories.map((category) => (
                <label className="interest-option" key={category}>
                  <input
                    type="checkbox"
                    checked={selected.includes(category)}
                    aria-describedby={id}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, category]
                          : current.filter((item) => item !== category),
                      )
                    }
                  />
                  <span>{category}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {!visible.length && (
        <p role="status">Таких тем пока нет. Попробуйте другой запрос.</p>
      )}
    </fieldset>
  );
}
