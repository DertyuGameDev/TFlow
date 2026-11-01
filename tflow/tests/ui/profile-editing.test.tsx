import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExpandedProfileForm } from "../../app/ui/profile-data";
import { profile } from "../fixtures";

describe("необязательные данные профиля", () => {
  it("отмечает обязательной только почту аккаунта", () => {
    const { container } = render(<ExpandedProfileForm profile={profile} send={vi.fn()} done={vi.fn()} />);
    const email = screen.getByRole("textbox", { name: /Электронная почта/ });
    expect(email).toHaveValue(profile.email);
    expect(email).toBeRequired();
    expect(email).toHaveAttribute("readonly");
    expect(container.querySelectorAll("[required]")).toHaveLength(1);
    expect(container.querySelector(".profile-required-mark")).toHaveTextContent("*");
    expect(screen.getByLabelText("Имя", { exact: true })).not.toBeRequired();
    expect(screen.getByLabelText("Фамилия", { exact: true })).not.toBeRequired();
    expect(screen.getByText(/Остальные поля можно оставить пустыми/)).toBeVisible();
  });

  it("позволяет очистить данные и сохранить профиль с одной почтой", async () => {
    const user = userEvent.setup(), send = vi.fn().mockResolvedValue({ ok: true }), done = vi.fn();
    render(<ExpandedProfileForm profile={profile} send={send} done={done} />);
    await user.clear(screen.getByLabelText("Имя", { exact: true }));
    await user.clear(screen.getByLabelText("Фамилия", { exact: true }));
    await user.clear(screen.getByRole("combobox", { name: "Город" }));
    await user.click(screen.getByRole("button", { name: "Сохранить профиль" }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith("profile", "PATCH", expect.objectContaining({
      first_name: "", last_name: "", city: "", phone: "", birth_date: "", telegram: "",
      organization: "", job_title: "", education: "", website: "", about: "", interests: "",
    }));
    expect(send.mock.calls[0][2]).not.toHaveProperty("email");
  });

  it("сохраняет только фамилию без требования имени", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    render(<ExpandedProfileForm profile={{ ...profile, first_name: "", city: "" }} send={send} done={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Сохранить профиль" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith("profile", "PATCH", expect.objectContaining({
      first_name: "", last_name: profile.last_name,
    })));
  });
});
