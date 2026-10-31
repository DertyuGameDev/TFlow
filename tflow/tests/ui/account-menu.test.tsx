import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AccountMenu } from "../../app/ui/account-menu";
import { profile } from "../fixtures";

afterEach(() => { document.cookie = "csrftoken=; Max-Age=0; path=/"; });

describe("меню аккаунта", () => {
  it("открывается по аватару и закрывается повторным кликом или выбором профиля", async () => {
    const user = userEvent.setup();
    render(<AccountMenu profile={profile} />);
    const trigger = screen.getByRole("button", { name: "Меню аккаунта" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    expect(screen.getByRole("menuitem", { name: "Доступ по ключу" })).toHaveAttribute("href", "#access");
    expect(screen.getByRole("menuitem", { name: "Профиль" })).toHaveFocus();
    await user.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Профиль" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("выход использует POST и текущий CSRF-токен", async () => {
    document.cookie = "csrftoken=local-test-token; path=/";
    const user = userEvent.setup();
    render(<AccountMenu profile={profile} />);
    await user.click(screen.getByRole("button", { name: "Меню аккаунта" }));
    const form = screen.getByRole("menuitem", { name: "Выйти из аккаунта" }).closest("form")!;
    expect(form).toHaveAttribute("action", "/logout/");
    expect(form).toHaveAttribute("method", "post");
    expect(new FormData(form).get("csrfmiddlewaretoken")).toBe("local-test-token");
  });

  it("поддерживает стрелки, Escape, Tab и закрытие снаружи", async () => {
    const user = userEvent.setup();
    render(<><AccountMenu profile={profile} /><button>Снаружи</button></>);
    const trigger = screen.getByRole("button", { name: "Меню аккаунта" });
    trigger.focus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Выйти из аккаунта" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Профиль" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Выйти из аккаунта" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger);
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Снаружи" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
