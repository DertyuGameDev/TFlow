// Shared by the app and the server-rendered sign-in forms. Run before paint.
(() => {
  const key = "tflow-theme";
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = null;
  try {
    const stored =
      localStorage.getItem(key) || localStorage.getItem("tflow.theme");
    if (stored === "light" || stored === "dark") preference = stored;
  } catch {
    /* The switch still works when browser storage is unavailable. */
  }

  function syncControls() {
    const dark = root.dataset.theme === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute(
        "title",
        dark ? "Включить светлую тему" : "Включить тёмную тему",
      );
    });
  }

  function apply() {
    root.dataset.theme = preference || (system.matches ? "dark" : "light");
    root.style.colorScheme = root.dataset.theme;
    syncControls();
    window.dispatchEvent(new Event("tflow:theme-change"));
  }

  document.addEventListener("click", (event) => {
    if (
      !(event.target instanceof Element) ||
      !event.target.closest("[data-theme-toggle]")
    )
      return;
    preference = root.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(key, preference);
    } catch {
      /* Keep the choice for this page. */
    }
    apply();
  });
  system.addEventListener("change", () => {
    if (!preference) apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    preference =
      event.newValue === "dark" || event.newValue === "light"
        ? event.newValue
        : null;
    apply();
  });
  document.addEventListener("DOMContentLoaded", syncControls);
  apply();
})();
