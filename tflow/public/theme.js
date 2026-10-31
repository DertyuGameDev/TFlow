/* Shared by the React app and Django authentication pages. Apply before paint. */
(() => {
  const key = "tflow-theme";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const valid = value => value === "dark" || value === "light";
  let preference = null;
  try { const saved = localStorage.getItem(key); if (valid(saved)) preference = saved; } catch { /* Storage may be disabled. */ }

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll("[data-auth-theme-toggle]").forEach(button => {
      button.setAttribute("aria-pressed", String(theme === "dark"));
      button.setAttribute("aria-label", theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему");
    });
    window.dispatchEvent(new Event("tflow-theme-change"));
  }
  const resolved = () => preference ?? (system.matches ? "dark" : "light");
  apply(resolved());
  document.addEventListener("DOMContentLoaded", () => apply(resolved()), { once: true });
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-theme-toggle]")) return;
    preference = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(key, preference); } catch { /* Keep the choice for this page. */ }
    apply(preference);
  });
  system.addEventListener("change", () => { if (!preference) apply(resolved()); });
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === null) {
      preference = valid(event.newValue) ? event.newValue : null;
      apply(resolved());
    }
  });
})();
