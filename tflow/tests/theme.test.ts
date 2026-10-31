import { describe, expect, it, vi } from "vitest";
import themeScript from "../public/theme.js?raw";

function themePage({ saved, dark = false, blockedStorage = false }: { saved?: string; dark?: boolean; blockedStorage?: boolean } = {}) {
  const document = globalThis.document.implementation.createHTMLDocument("Theme test");
  const system = Object.assign(new EventTarget(), { matches: dark });
  const browser = Object.assign(new EventTarget(), { matchMedia: () => system });
  const storage = {
    getItem: vi.fn(() => { if (blockedStorage) throw new Error("storage denied"); return saved ?? null; }),
    setItem: vi.fn(() => { if (blockedStorage) throw new Error("storage denied"); }),
  };
  const button = document.createElement("button");
  button.setAttribute("data-theme-toggle", ""); button.setAttribute("data-auth-theme-toggle", "");
  const icon = document.createElement("span"); button.append(icon); document.body.append(button);
  const changed = vi.fn(); browser.addEventListener("tflow-theme-change", changed);
  new Function("window", "document", "localStorage", "Element", "Event", themeScript)(browser, document, storage, Element, Event);
  return { document, button, icon, browser, storage, system, changed,
    click: () => icon.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    systemTheme: (matches: boolean) => { system.matches = matches; system.dispatchEvent(new Event("change")); },
    sharedTheme: (value: string | null, key: string | null = "tflow-theme") => browser.dispatchEvent(new StorageEvent("storage", { key, newValue: value })),
  };
}

describe("общая тема приложения и страниц входа", () => {
  it("первое открытие следует системной теме, невалидное сохранённое значение игнорируется", () => {
    expect(themePage({ dark: true }).document.documentElement.dataset.theme).toBe("dark");
    expect(themePage({ saved: "unexpected", dark: false }).document.documentElement.dataset.theme).toBe("light");
  });
  it("ручной выбор важнее системного и переживает её изменение", () => {
    const page = themePage({ saved: "light", dark: true });
    page.systemTheme(true);
    expect(page.document.documentElement.dataset.theme).toBe("light");
    page.click();
    expect(page.document.documentElement.dataset.theme).toBe("dark");
    expect(page.storage.setItem).toHaveBeenCalledWith("tflow-theme", "dark");
    page.systemTheme(false);
    expect(page.document.documentElement.dataset.theme).toBe("dark");
  });
  it("без ручного выбора следует изменению системы", () => {
    const page = themePage(); page.systemTheme(true);
    expect(page.document.documentElement.dataset.theme).toBe("dark");
    page.systemTheme(false);
    expect(page.document.documentElement.dataset.theme).toBe("light");
  });
  it("синхронизирует вкладки, а очистка выбора возвращает системную тему", () => {
    const page = themePage({ dark: true });
    page.sharedTheme("light");
    expect(page.document.documentElement.dataset.theme).toBe("light");
    page.sharedTheme(null);
    expect(page.document.documentElement.dataset.theme).toBe("dark");
    page.sharedTheme("light", "unrelated");
    expect(page.document.documentElement.dataset.theme).toBe("dark");
  });
  it("отказ хранилища не мешает переключать тему на текущей странице", () => {
    const page = themePage({ blockedStorage: true });
    page.click();
    expect(page.document.documentElement.dataset.theme).toBe("dark");
    expect(page.button.getAttribute("aria-label")).toBe("Включить светлую тему");
    expect(page.button.getAttribute("aria-pressed")).toBe("true");
  });
  it("меняет логотип страницы входа после загрузки и при ручном переключении", () => {
    const page = themePage({ dark: true });
    const image = page.document.createElement("img");
    image.setAttribute("data-theme-logo", "");
    image.dataset.logoLightSrc = "/static/logo.svg";
    image.dataset.logoDarkSrc = "/static/logo-dark.svg";
    image.src = "/static/logo.svg";
    page.document.body.append(image);
    page.document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(image.getAttribute("src")).toBe("/static/logo-dark.svg");
    page.click();
    expect(image.getAttribute("src")).toBe("/static/logo.svg");
  });
  it("обновляет кнопки, появившиеся при загрузке, и не дублирует theme-color", () => {
    const page = themePage({ dark: true });
    page.document.dispatchEvent(new Event("DOMContentLoaded")); page.click(); page.click();
    expect(page.document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
    expect(page.document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#18191b");
    expect(page.changed).toHaveBeenCalled();
  });
});
