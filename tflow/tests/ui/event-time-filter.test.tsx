import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TFlow } from "../../app/tflow";
import { event, profile } from "../fixtures";

afterEach(() => history.replaceState({}, "", "/"));

describe("фильтр активных событий", () => {
  it("разделяет идущие события и подтверждённые посещения, скрывая простые регистрации из истории", async () => {
    const now = event.starts_at;
    vi.spyOn(Date,"now").mockReturnValue(now);
    vi.spyOn(window,"scrollTo").mockImplementation(()=>{});
    history.replaceState({},"","/#events");
    const events = [event, {...event,id:"future",title:"Будущее",starts_at:now+7200000,ends_at:now+10800000},
      {...event,id:"visited",title:"Подтверждено",checked_in:1,starts_at:now-7200000,ends_at:now-1},
      {...event,id:"ticket",title:"Просто билет",enrolled:1,starts_at:now-7200000,ends_at:now-1}];
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({events,tickets:[],schedule:[],waitlist:[],communities:[],notifications:[],unread_notification_count:0,profile}),{status:200})));
    const user=userEvent.setup();
    const view=render(<TFlow user={{userId:profile.id,role:"participant",displayName:profile.name,email:profile.email,fullName:profile.name}}/>);
    await screen.findByText("Будущее");
    expect(within(screen.getByRole("group", { name: "Состояние мероприятий" })).getAllByRole("button").map(button => button.textContent)).toEqual(["Все", "Активные", "Завершённые"]);
    expect(screen.queryByText("Где был")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Фильтры событий" }));
    await user.click(screen.getByRole("checkbox", { name: "Идут сейчас" }));
    await user.click(screen.getByRole("button", { name: "Показать события" }));
    expect(screen.getByText(event.title)).toBeVisible();
    expect(screen.queryByText("Будущее")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Фильтры событий" })).toHaveTextContent("1");
    await user.click(screen.getByRole("button", { name: "Фильтры событий" }));
    await user.click(screen.getByRole("checkbox", { name: "Идут сейчас" }));
    await user.click(screen.getByRole("checkbox", { name: "С подтверждённым посещением" }));
    await user.click(screen.getByRole("button", { name: "Показать события" }));
    expect(screen.getByText("Подтверждено")).toBeVisible();
    expect(screen.queryByText("Просто билет")).not.toBeInTheDocument();
    const visited = screen.getByRole("button", { name: "Открыть Подтверждено" }).closest("article")!;
    expect(within(visited).getByText("Посещение подтверждено")).toHaveClass("attendance-confirmed-tag");
    expect(visited.querySelector(".discovery-cover .attendance-confirmed-tag")).not.toBeNull();
    view.unmount();
    render(<TFlow user={null}/>);
    await screen.findByText("Будущее");
    await user.click(screen.getByRole("button", { name: "Фильтры событий" }));
    await user.click(screen.getByRole("checkbox", { name: "С подтверждённым посещением" }));
    await user.click(screen.getByRole("button", { name: "Показать события" }));
    expect(screen.getByRole("heading",{name:"Ваша история посещений"})).toBeVisible();
    expect(screen.queryByText("Подтверждено")).not.toBeInTheDocument();
  });
  it("сочетает посещение с завершёнными и позволяет снять отдельный фильтр", async () => {
    const now = event.starts_at;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    history.replaceState({}, "", "/#events");
    const events = [
      { ...event, id: "visited-past", title: "Посещённая встреча", checked_in: 1, ends_at: now - 1 },
      { ...event, id: "ticket-past", title: "Только регистрация", enrolled: 1, ends_at: now - 1 },
      { ...event, id: "visited-now", title: "Сейчас на встрече", checked_in: 1, enrolled: 1 },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      events, tickets: [], schedule: [], waitlist: [], communities: [], notifications: [], unread_notification_count: 0, profile,
    }))));
    const user = userEvent.setup();
    render(<TFlow user={{userId:profile.id,role:"participant",displayName:profile.name,email:profile.email,fullName:profile.name}} />);
    await screen.findByText("Посещённая встреча");
    const registered = screen.getByRole("button", { name: "Открыть Только регистрация" }).closest("article")!;
    expect(registered.querySelector(".attendance-confirmed-tag")).toBeNull();
    const current = screen.getByRole("button", { name: "Открыть Сейчас на встрече" }).closest("article")!;
    expect(current.querySelector(".attendance-confirmed-tag")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Завершённые" }));
    await user.click(screen.getByRole("button", { name: "Фильтры событий" }));
    await user.click(screen.getByRole("checkbox", { name: "С подтверждённым посещением" }));
    await user.click(screen.getByRole("button", { name: "Показать события" }));
    expect(screen.getByText("Посещённая встреча")).toBeVisible();
    expect(screen.queryByText("Только регистрация")).not.toBeInTheDocument();
    expect(screen.queryByText("Сейчас на встрече")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Убрать фильтр подтверждённых посещений" }));
    expect(screen.getByText("Только регистрация")).toBeVisible();
    expect(screen.queryByText("Сейчас на встрече")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Завершённые" })).toHaveAttribute("aria-pressed", "true");
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
