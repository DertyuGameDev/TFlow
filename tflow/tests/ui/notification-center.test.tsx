import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "../../app/ui/notification-center";
import type { Send } from "../../app/ui/forms";
import type { NoticePage } from "../../lib/types";
import { deferred, notice } from "../fixtures";

function mount(send: Send, extra = {}) {
  return render(<NotificationCenter send={send} unreadCount={2} revision="one" onChange={vi.fn().mockResolvedValue(undefined)} onOpen={vi.fn()} {...extra} />);
}

describe("центр уведомлений", () => {
  it("показывает новое событие клуба и открывает его после прочтения", async () => {
    const user = userEvent.setup(), onOpen = vi.fn();
    const send = vi.fn().mockResolvedValueOnce({ items: [notice("club", { kind: "club_event" })], next_cursor: null }).mockResolvedValue({ ok: true });
    mount(send, { onOpen });
    expect(await screen.findByRole("heading", { name: "Новое событие клуба" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Открыть событие" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("event-one"));
    expect(send).toHaveBeenLastCalledWith("notifications/club", "PATCH", {});
  });

  it("загружает следующую страницу без дублей", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValueOnce({ items: [notice("one")], next_cursor: "one" })
      .mockResolvedValueOnce({ items: [notice("one", { read: 1 }), notice("two")], next_cursor: null });
    mount(send);
    await screen.findByText("Сообщение one");
    await user.click(screen.getByRole("button", { name: "Показать ещё" }));
    expect(await screen.findByText("Сообщение two")).toBeVisible();
    expect(screen.getAllByText("Сообщение one")).toHaveLength(1);
    expect(send).toHaveBeenLastCalledWith("notifications?before=one", "GET");
    expect(screen.queryByRole("button", { name: "Показать ещё" })).not.toBeInTheDocument();
  });

  it("запоздалый ответ старого фильтра не заменяет непрочитанные", async () => {
    const user = userEvent.setup(), old = deferred<NoticePage>(), recent = deferred<NoticePage>();
    const send = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
    mount(send);
    await user.click(screen.getByRole("button", { name: /Непрочитанные/ }));
    expect(send).toHaveBeenLastCalledWith("notifications?unread=1", "GET");
    await act(async () => recent.resolve({ items: [notice("fresh")], next_cursor: null }));
    await screen.findByText("Сообщение fresh");
    await act(async () => old.resolve({ items: [notice("stale", { read: 1 })], next_cursor: null }));
    expect(screen.getByText("Сообщение fresh")).toBeVisible();
    expect(screen.queryByText("Сообщение stale")).not.toBeInTheDocument();
  });

  it("перед открытием непрочитанного события сохраняет прочтение и обновляет счётчик", async () => {
    const user = userEvent.setup(), onOpen = vi.fn(), onChange = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValueOnce({ items: [notice("one")], next_cursor: null }).mockResolvedValue({ ok: true });
    mount(send, { onOpen, onChange });
    await user.click(await screen.findByRole("button", { name: "Открыть событие" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("event-one"));
    expect(send).toHaveBeenLastCalledWith("notifications/one", "PATCH", {});
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("прочитанная отмена открывает календарь без лишней записи на сервер", async () => {
    const user = userEvent.setup(), onOpen = vi.fn();
    const send = vi.fn().mockResolvedValue({ items: [notice("cancelled", { read: 1, event_id: null, kind: "event_cancelled" })], next_cursor: null });
    mount(send, { onOpen });
    await user.click(await screen.findByRole("button", { name: "Открыть календарь" }));
    expect(onOpen).toHaveBeenCalledWith(null);
    expect(send).toHaveBeenCalledOnce();
  });

  it("ошибка отметки прочтения не открывает событие и позволяет повторить действие", async () => {
    const user = userEvent.setup(), onOpen = vi.fn();
    const send = vi.fn().mockResolvedValueOnce({ items: [notice("one")], next_cursor: null })
      .mockRejectedValueOnce(new Error("Сбой сохранения")).mockResolvedValue({ ok: true });
    mount(send, { onOpen });
    await user.click(await screen.findByRole("button", { name: "Открыть событие" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сбой сохранения");
    expect(onOpen).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Открыть событие" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce());
  });

  it("после ошибки загрузки обновляет список по явному повтору", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockRejectedValueOnce(new Error("Сеть недоступна"))
      .mockResolvedValue({ items: [notice("recovered")], next_cursor: null });
    mount(send);
    expect(await screen.findByRole("alert")).toHaveTextContent("Сеть недоступна");
    await user.click(screen.getByRole("button", { name: "Обновить уведомления" }));
    expect(await screen.findByText("Сообщение recovered")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
