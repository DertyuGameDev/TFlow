import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

function subscribe(callback: () => void) {
  window.addEventListener("tflow:theme-change", callback);
  return () => window.removeEventListener("tflow:theme-change", callback);
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.theme === "dark",
  );
  return (
    <button
      type="button"
      className="theme-toggle"
      data-theme-toggle
      aria-label="Тёмная тема"
      aria-pressed={dark}
      title={dark ? "Включить светлую тему" : "Включить тёмную тему"}
    >
      <Moon className="theme-icon-moon" aria-hidden="true" />
      <Sun className="theme-icon-sun" aria-hidden="true" />
    </button>
  );
}
