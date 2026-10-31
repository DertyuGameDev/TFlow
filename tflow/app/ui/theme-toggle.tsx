import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

function subscribe(onChange: () => void) {
  window.addEventListener("tflow-theme-change", onChange);
  return () => window.removeEventListener("tflow-theme-change", onChange);
}
const snapshot = () => document.documentElement.dataset.theme === "dark";

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, snapshot, () => false);
  const label = dark ? "Включить светлую тему" : "Включить тёмную тему";
  return <button type="button" className="theme-toggle icon-button" data-theme-toggle aria-label={label} title={label} aria-pressed={dark}>
    {dark ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
    <span className="theme-toggle-label" aria-hidden="true">{dark ? "Светлая" : "Тёмная"}</span>
  </button>;
}
