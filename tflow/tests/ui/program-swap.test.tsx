import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProgramSwap } from "../../app/ui/program-swap";
import { deferred, event } from "../fixtures";
import type { Activity } from "../../lib/types";

const a = {id:"a", title:"Доклад", starts_at:event.starts_at, ends_at:event.starts_at+3600000, room_name:"Зал"} as Activity;
const b = {...a,id:"b",title:"Обсуждение",starts_at:a.ends_at,ends_at:a.ends_at+1800000};
const detail = {event, activities:[a,b], rooms:[]};
const change = {id:a.id,title:a.title,before:a,after:{starts_at:a.starts_at+1800000,ends_at:a.ends_at+1800000}};
describe("обмен пунктов программы", () => {
  it("сначала показывает серверный предпросмотр и сохраняет только после подтверждения", async () => {
    const send = vi.fn().mockResolvedValue({changes:[change]}), close = vi.fn(), refresh = vi.fn().mockResolvedValue(undefined), user = userEvent.setup();
    render(<ProgramSwap activity={a} detail={detail} send={send} refresh={refresh} onClose={close}/>);
    const confirm = screen.getByRole("button",{name:"Подтвердить обмен"});
    expect(confirm).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox"),"b");
    expect(await screen.findByRole("list",{name:"Изменения расписания"})).toHaveTextContent("Будет:");
    expect(send).toHaveBeenCalledExactlyOnceWith("activities/a/swap","POST",{other_id:"b",expected_event_updated_at:event.updated_at,preview:true});
    await user.click(confirm);
    await waitFor(()=>expect(close).toHaveBeenCalledOnce());
    expect(send).toHaveBeenLastCalledWith("activities/a/swap","POST",{other_id:"b",expected_event_updated_at:event.updated_at});
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("устаревший ответ предпросмотра не разблокирует сохранение после смены выбора", async () => {
    const pending = deferred<unknown>(), send = vi.fn(() => pending.promise), user = userEvent.setup();
    render(<ProgramSwap activity={a} detail={detail} send={send} refresh={vi.fn()} onClose={vi.fn()}/>);
    await user.selectOptions(screen.getByRole("combobox"),"b");
    await user.selectOptions(screen.getByRole("combobox"),"");
    await act(async()=>pending.resolve({changes:[change]}));
    expect(screen.getByRole("button",{name:"Подтвердить обмен"})).toBeDisabled();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
  it("показывает конфликт сервера и не даёт подтвердить обмен", async () => {
    const send = vi.fn().mockRejectedValue(new Error("У участника пересечение")), user = userEvent.setup();
    render(<ProgramSwap activity={a} detail={detail} send={send} refresh={vi.fn()} onClose={vi.fn()}/>);
    await user.selectOptions(screen.getByRole("combobox"),"b");
    expect(await screen.findByRole("alert")).toHaveTextContent("пересечение");
    expect(screen.getByRole("button",{name:"Подтвердить обмен"})).toBeDisabled();
  });
});
