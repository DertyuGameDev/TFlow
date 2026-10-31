import { useDarkTheme } from "../../lib/use-theme";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const dark = useDarkTheme();
  const label = dark ? "Включить светлую тему" : "Включить тёмную тему";
  return <button type="button" className="theme-toggle icon-button" data-theme-toggle aria-label={label} title={label} aria-pressed={dark}>
    {dark ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
    <span className="theme-toggle-label" aria-hidden="true">{dark ? "Светлая" : "Тёмная"}</span>
  </button>;
}
