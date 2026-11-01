import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EventParticipants } from "../../app/ui/event-participants";
import { OrganizerManage } from "../../app/ui/organizer-manage";
import type { AttendanceRow } from "../../lib/types";
import { event, profile } from "../fixtures";

const attendees: AttendanceRow[] = Array.from({ length: 7 }, (_, index) => ({
  id: `person-${index}`,
  name: `Участник ${index + 1}`,
  email: `person${index}@example.test`,
  city: "Москва",
  profile_data: {
    ...profile,
    name: `Участник ${index + 1}`,
    email: `person${index}@example.test`,
    phone: `+7 999 111-22-0${index}`,
    organization: `Компания ${index + 1}`,
    about: `Анкета ${index + 1}`,
  },
  created_at: event.starts_at - index * 1000,
  checked_in_at: null,
}));

const manageProps = {
  detail: { event: { ...event, participant_count: 7 }, rooms: [], activities: [] },
  rows: attendees,
  busy: false,
  onScan: vi.fn(), onMove: vi.fn(), onSchedule: vi.fn(), onCreate: vi.fn(), onEdit: vi.fn(),
  onDelete: vi.fn(), onPublish: vi.fn(), onRoom: vi.fn(), onActivity: vi.fn(),
  onOpenPublic: vi.fn(), onOpenWebinar: vi.fn(), send: vi.fn(), refresh: vi.fn(),
};

describe("превью участников события", () => {
  it.each(["", "   "])("показывает базовую аватарку при незаполненном имени %j в обоих списках", (name) => {
    const rows = [{ ...attendees[0], name }];
    const view = render(<EventParticipants rows={rows} onShowAll={vi.fn()} />);
    expect(view.container.querySelector(".small-person-avatar svg")).toBeVisible();
    view.rerender(<OrganizerManage {...manageProps} rows={rows} initialSection="participants" />);
    expect(view.container.querySelector(".attendee-row .small-person-avatar svg")).toBeVisible();
    expect(within(view.container.querySelector(".attendee-row") as HTMLElement).getByText(rows[0].email)).toBeVisible();
  });

  it("показывает пять последних регистраций и общее количество", () => {
    render(<EventParticipants rows={attendees} onShowAll={vi.fn()} />);
    const region = screen.getByRole("region", { name: /Участники\s*7/ });
    expect(within(region).getAllByRole("button", { name: /Открыть профиль:/ })).toHaveLength(5);
    expect(within(region).getByText("Участник 1")).toBeVisible();
    expect(within(region).getByText("Участник 5")).toBeVisible();
    expect(within(region).queryByText("Участник 6")).not.toBeInTheDocument();
    expect(screen.queryByText(attendees[0].email)).not.toBeInTheDocument();
  });

  it("открывает анкету выбранного человека и возвращает фокус при закрытии", async () => {
    const user = userEvent.setup();
    render(<EventParticipants rows={attendees} onShowAll={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Открыть профиль: Участник 2" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Участник 2" });
    expect(within(dialog).getByText(attendees[1].email)).toBeVisible();
    expect(within(dialog).getByText(attendees[1].profile_data.phone)).toBeVisible();
    expect(within(dialog).getByText("Анкета 2")).toBeVisible();
    expect(within(dialog).getByText(/Данные при записи/)).toBeVisible();
    expect(within(dialog).queryByText(attendees[0].email)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Закрыть" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("не оставляет открытой анкету участника, который отменил запись", async () => {
    const user = userEvent.setup(), onShowAll = vi.fn();
    const view = render(<EventParticipants rows={attendees} onShowAll={onShowAll} />);
    await user.click(screen.getByRole("button", { name: "Открыть профиль: Участник 1" }));
    view.rerender(<EventParticipants rows={attendees.slice(1)} onShowAll={onShowAll} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(attendees[0].email)).not.toBeInTheDocument();
  });

  it("объясняет пустое состояние и не предлагает открыть отсутствующих участников", () => {
    render(<EventParticipants rows={[]} onShowAll={vi.fn()} />);
    expect(screen.getByText(/Пока никто не зарегистрировался/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("показывает единый список, где можно найти и шестого участника", async () => {
    const user = userEvent.setup();
    render(<OrganizerManage {...manageProps} />);
    expect(screen.getByRole("tab", { name: "Событие" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Участники события" })).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "Найти участника" }), "Участник 6");
    const panel = screen.getByRole("region", { name: "Участники события" });
    expect(within(panel).getByText("Участник 6")).toBeVisible();
    expect(within(panel).queryByText("Участник 1")).not.toBeInTheDocument();
    await user.click(within(panel).getByText("Участник 6"));
    expect(within(panel).getByText("Анкета 6")).toBeVisible();
  });

  it("позволяет сразу открыть вкладку участников по переходу со страницы события", () => {
    render(<OrganizerManage {...manageProps} initialSection="participants" />);
    expect(screen.getByRole("tab", { name: "Событие" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "Найти участника" })).toBeVisible();
  });
});

it('открывает требования сразу в заметной верхней вкладке и сохраняет их без модального окна',async()=>{
 const send=vi.fn().mockResolvedValue({ok:true}),refresh=vi.fn().mockResolvedValue(undefined),user=userEvent.setup();
 render(<OrganizerManage {...manageProps} send={send} refresh={refresh}/>);
 const tab=screen.getByRole('tab',{name:'Что спросить при записи'});await user.click(tab);
 const panel=screen.getByRole('tabpanel',{name:'Что спросить при записи'});expect(panel).toBeVisible();
 await user.click(within(panel).getByLabelText('Телефон'));await user.click(within(panel).getByRole('button',{name:'Сохранить требования'}));
 expect(send).toHaveBeenCalledWith(`events/${event.id}/requirements`,'PATCH',{required_profile_fields:['phone']});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
