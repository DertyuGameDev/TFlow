import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActivityCard } from "../../app/ui/activity-program";
import { activity } from "../fixtures";

describe("активности без отдельной регистрации", () => {
  it("показывает добавление в расписание вместо бронирования даже при заполненном лимите", async () => {
    const onAction = vi.fn(), user = userEvent.setup();
    const open = {...activity, registration_required:false, event_enrolled:true, taken:100, capacity:1};
    render(<ActivityCard activity={open} schedule={[]} organizer={false} pending={false} onAction={onAction}/>);
    expect(screen.getByText("Без отдельной регистрации")).toBeVisible();
    expect(screen.queryByText("Мест нет")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", {name:"В расписание"}));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(open, "register");
  });
  it("для посетителя без билета предлагает сначала запись на мероприятие", () => {
    render(<ActivityCard activity={{...activity, registration_required:false, event_enrolled:false}} schedule={[]} organizer={false} pending={false} onAction={vi.fn()}/>);
    expect(screen.getByRole("button", {name:"Зарегистрироваться на мероприятие"})).toBeEnabled();
  });
  it("удаляет только календарную отметку и оставляет вход в открытый онлайн-флоу", async () => {
    const onAction = vi.fn(), user = userEvent.setup();
    const open = {...activity, registration_required:false, event_enrolled:true, registered:1, room_is_online:true};
    render(<ActivityCard activity={open} schedule={[open]} userId="person" organizer={false} pending={false} onAction={onAction}/>);
    expect(screen.getByText("В вашем расписании")).toBeVisible();
    await user.click(screen.getByRole("button", {name:"Убрать из расписания"}));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(open, "cancel");
    expect(screen.getByRole("link", {name:"Войти в вебинар флоу"})).toBeVisible();
  });
});
