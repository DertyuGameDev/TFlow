import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("tflow-theme-change", onChange);
  return () => window.removeEventListener("tflow-theme-change", onChange);
}
const snapshot = () => document.documentElement.dataset.theme === "dark";

export function useDarkTheme() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
