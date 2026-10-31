import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CompleteRegistrationForm, RegistrationSettings } from "../../app/ui/profile-data";
import { ApiError } from "../../lib/api-error";
import { event, profile } from "../fixtures";

describe("дополнение анкеты перед регистрацией", () => {
  it("сохраняет введённый телефон, если сервер запросил дополнительное поле", async () => {
    const user = userEvent.setup(), done = vi.fn();
    const send = vi.fn().mockRejectedValueOnce(new ApiError({ error: "Нужно место работы", code: "PROFILE_INCOMPLETE", missing_fields: ["organization"] }))
      .mockResolvedValue({ ok: true });
    render(<CompleteRegistrationForm profile={profile} event={event} path="events/event-one/registration" missing={["phone"]} send={send} done={done} />);
    await user.type(screen.getByLabelText(/Телефон/), "+7 999 123-45-67");
    await user.click(screen.getByRole("button", { name: "Сохранить и записаться" }));
    expect(await screen.findByLabelText(/Место работы/)).toBeVisible();
    expect(screen.getByLabelText(/Телефон/)).toHaveValue("+7 999 123-45-67");
    expect(done).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/Место работы/), "Университет");
    await user.click(screen.getByRole("button", { name: "Сохранить и записаться" }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(send).toHaveBeenLastCalledWith("events/event-one/registration", "POST", { phone: "+7 999 123-45-67", organization: "Университет" });
  });

  it("сохраняет заполненные поля при обычной ошибке и показывает ошибки у нужного поля", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockRejectedValue(new ApiError({ error: "Исправьте телефон", fields: { phone: ["Некорректный номер"] } }));
    render(<CompleteRegistrationForm profile={profile} event={event} path="activities/one/registration" missing={["phone"]} send={send} done={vi.fn()} />);
    await user.type(screen.getByLabelText(/Телефон/), "12345");
    await user.click(screen.getByRole("button", { name: "Сохранить и записаться" }));
    expect(await screen.findByText("Некорректный номер")).toBeVisible();
    expect(screen.getByLabelText(/Телефон/)).toHaveValue("12345");
    expect(screen.getByLabelText(/Телефон/)).toHaveAttribute("aria-invalid", "true");
  });
});

describe("требования организатора к анкете", () => {
  it("отправляет выбранные требования и разрешает очистить их", async () => {
    const user = userEvent.setup(), send = vi.fn().mockResolvedValue({ ok: true }), refresh = vi.fn().mockResolvedValue(undefined);
    const view = render(<RegistrationSettings event={event} send={send} refresh={refresh} />);
    await user.click(screen.getByText("Данные при записи"));
    expect(screen.getByRole("button", { name: "Сохранить требования" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Телефон" }));
    await user.click(screen.getByRole("button", { name: "Сохранить требования" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(send).toHaveBeenLastCalledWith("events/event-one/requirements", "PATCH", { required_profile_fields: ["phone"] });
    view.rerender(<RegistrationSettings event={{ ...event, required_profile_fields: ["phone"] }} send={send} refresh={refresh} />);
    await user.click(screen.getByRole("checkbox", { name: "Телефон" }));
    await user.click(screen.getByRole("button", { name: "Сохранить требования" }));
    await waitFor(() => expect(send).toHaveBeenLastCalledWith("events/event-one/requirements", "PATCH", { required_profile_fields: [] }));
  });
});
