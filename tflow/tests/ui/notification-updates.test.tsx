import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNotificationUpdates } from "../../app/ui/use-notification-updates";
import { deferred, notice } from "../fixtures";
afterEach(()=>vi.useRealTimers());
describe("быстрое обновление уведомлений",()=>{
  it("не запускает параллельные запросы и прекращает обновления после выхода",async()=>{
    vi.useFakeTimers();const pending=deferred<unknown>(),send=vi.fn().mockReturnValue(pending.promise),set=vi.fn();
    const view=renderHook(({id})=>useNotificationUpdates(id,send,set),{initialProps:{id:"user" as string|undefined}});
    expect(send).toHaveBeenCalledOnce();await act(()=>vi.advanceTimersByTimeAsync(15000));expect(send).toHaveBeenCalledOnce();
    view.rerender({id:undefined});await act(async()=>pending.resolve({latest:notice("new"),unread_count:1}));expect(set).not.toHaveBeenCalled();
  });
  it("возврат фокуса обновляет счётчик без запроса полной страницы",async()=>{
    const send=vi.fn().mockResolvedValue({latest:notice("fresh"),unread_count:3}),set=vi.fn();
    renderHook(()=>useNotificationUpdates("user",send,set));await act(async()=>{});
    act(()=>window.dispatchEvent(new Event("focus")));await act(async()=>{});
    expect(send).toHaveBeenLastCalledWith("notifications/summary","GET");expect(set).toHaveBeenCalled();
  });
});
