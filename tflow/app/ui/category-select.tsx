import { useId } from "react";
import { CATEGORY_GROUPS, TOPICS } from "../../lib/types";

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
  const current = value ?? defaultValue ?? "";
  return (
    <label className="category-select" htmlFor={id}>
      Категория
      <select
        id={id}
        name="topic"
        required={!allowAll}
        value={value}
        defaultValue={value === undefined ? (defaultValue ?? "") : undefined}
        onChange={(event) => onChange?.(event.target.value)}
      >
        <option value="">
          {allowAll ? "Все категории" : "Выберите категорию"}
        </option>
        {current && !TOPICS.includes(current) && (
          <option value={current}>{current}</option>
        )}
        {CATEGORY_GROUPS.map((group) => (
          <optgroup label={group.name} key={group.name}>
            {group.categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
