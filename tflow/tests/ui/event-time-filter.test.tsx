import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TFlow } from "../../app/tflow";
import { event, profile } from "../fixtures";

afterEach(() => history.replaceState({}, "", "/"));

describe("фильтр активных событий", () => {
  it("убирает фильтр истории и помечает подтверждённые завершённые посещения в общем каталоге", async () => {
    const now = event.starts_at;
    vi.spyOn(Date,"now").mockReturnValue(now);
    vi.spyOn(window,"scrollTo").mockImplementation(()=>{});
    history.replaceState({},"","/#events");
    const events = [event, {...event,id:"future",title:"Будущее",starts_at:now+7200000,ends_at:now+10800000},
      {...event,id:"checked-now",title:"Участник уже вошёл",enrolled:1,checked_in:1},
      {...event,id:"visited",title:"Подтверждено",checked_in:1,starts_at:now-7200000,ends_at:now-1},
      {...event,id:"ticket",title:"Просто билет",enrolled:1,starts_at:now-7200000,ends_at:now-1}];
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({events,tickets:[],schedule:[],waitlist:[],communities:[],notifications:[],unread_notification_count:0,profile}),{status:200})));
    const user=userEvent.setup();
    const {container}=render(<TFlow user={{userId:profile.id,role:"participant",displayName:profile.name,email:profile.email,fullName:profile.name}}/>);
    await screen.findByText("Будущее");
    expect(screen.queryByRole("button",{name:"Где был"})).not.toBeInTheDocument();
    const cards=within(container.querySelector<HTMLElement>(".discovery-grid")!).getAllByRole("article");
    const visited=cards.find(card=>within(card).queryByRole("heading",{name:"Подтверждено"}))!;
    expect(visited).toHaveClass("is-past","is-visited");
    expect(within(visited).getByText("Вы посетили")).toHaveClass("event-visited-tag");
    const ticket=cards.find(card=>within(card).queryByRole("heading",{name:"Просто билет"}))!;
    expect(ticket).not.toHaveClass("is-visited");
    expect(within(ticket).getByText("Вы были записаны")).toBeVisible();
    const current=cards.find(card=>within(card).queryByRole("heading",{name:"Участник уже вошёл"}))!;
    expect(current).not.toHaveClass("is-visited");
    expect(within(current).getByText("Вы вошли")).toBeVisible();
    await user.click(screen.getByRole("button",{name:"Завершённые"}));
    expect(screen.getByText("Вы посетили")).toBeVisible();
    expect(screen.queryByText("Будущее")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Прямо сейчас"}));
    expect(screen.getByText(event.title)).toBeVisible();
    expect(screen.queryByText("Вы посетили")).not.toBeInTheDocument();
  });
  it("во «Всех» ставит завершённые в конец, сохраняя порядок внутри групп и доступ к карточке", async () => {
    const now = event.starts_at;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    history.replaceState({}, "", "/#events");
    const events = [
      { ...event, id: "past", title: "Прошедшая встреча", starts_at: now - 7200000, ends_at: now - 1, enrolled: 1 },
      { ...event, id: "current", title: "Текущая встреча" },
      { ...event, id: "boundary", title: "Только что завершилась", starts_at: now - 3600000, ends_at: now },
      { ...event, id: "future", title: "Будущая встреча", starts_at: now + 7200000, ends_at: now + 10800000 },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      events, tickets: [], schedule: [], waitlist: [], communities: [], notifications: [], unread_notification_count: 0, profile,
    }), { status: 200 })));
    const user = userEvent.setup();
    const { container } = render(<TFlow user={null} />);
    await screen.findByText("Текущая встреча");
    const grid = within(container.querySelector<HTMLElement>(".discovery-grid")!);
    expect(grid.getAllByRole("heading", { level: 2 }).map(heading => heading.textContent)).toEqual([
      "Текущая встреча", "Будущая встреча", "Прошедшая встреча", "Только что завершилась",
    ]);
    const cards = grid.getAllByRole("article");
    expect(cards[0]).not.toHaveClass("is-past");
    expect(cards[1]).not.toHaveClass("is-past");
    expect(cards[2]).toHaveClass("is-past");
    expect(cards[3]).toHaveClass("is-past");
    expect(within(cards[2]).getByText("Завершено")).toBeVisible();
    expect(within(cards[2]).getByText("Вы были записаны")).toBeVisible();
    expect(within(cards[2]).getByRole("button", { name: "Открыть Прошедшая встреча" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Активные" }));
    expect(screen.queryByText("Завершено")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Все" }));
    expect(grid.getAllByRole("heading", { level: 2 }).map(heading => heading.textContent)).toEqual([
      "Текущая встреча", "Будущая встреча", "Прошедшая встреча", "Только что завершилась",
    ]);
    expect(events[0].id).toBe("past");
  });

  it("фильтрует каталог и сбрасывает выбранное состояние", async () => {
    const now = event.starts_at;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    history.replaceState({}, "", "/#events");
    const events = [
      { ...event, id: "now", title: "Идёт сейчас" },
      { ...event, id: "past", title: "Уже прошло", starts_at: now - 7200000, ends_at: now - 1 },
      { ...event, id: "draft", title: "Черновик", status: "draft" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      events, tickets: [], schedule: [], waitlist: [], communities: [], notifications: [], unread_notification_count: 0, profile,
    }), { status: 200 })));
    const user = userEvent.setup();
    render(<TFlow user={null} />);
    expect(await screen.findByText("Идёт сейчас")).toBeVisible();
    expect(screen.getByText("Уже прошло")).toBeVisible();
    expect(screen.queryByText("Черновик")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Активные" }));
    expect(screen.getByText("Идёт сейчас")).toBeVisible();
    expect(screen.queryByText("Уже прошло")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Активные" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Завершённые" }));
    expect(screen.queryByText("Идёт сейчас")).not.toBeInTheDocument();
    expect(screen.getByText("Уже прошло")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Сбросить/ }));
    await waitFor(() => expect(screen.getByText("Идёт сейчас")).toBeVisible());
    expect(screen.getByText("Уже прошло")).toBeVisible();
  });
});
