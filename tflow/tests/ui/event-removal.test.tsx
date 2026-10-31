import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EventRemovalDialog } from "../../app/ui/event-removal-dialog";
import { event, deferred } from "../fixtures";

describe("подтверждение удаления и отмены записи", () => {
  it("отказ оставляет событие и не вызывает удаление", async () => {
    const user = userEvent.setup(), onClose = vi.fn(), onConfirm = vi.fn();
    render(<EventRemovalDialog event={event} deleting onClose={onClose} onConfirm={onConfirm} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Удалить мероприятие?");
    expect(screen.getByRole("button", { name: "Оставить мероприятие" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Оставить мероприятие" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ожидание ответа блокирует повторное удаление, Escape и закрытие", async () => {
    const user = userEvent.setup(), pending = deferred<void>(), onClose = vi.fn();
    const onConfirm = vi.fn(() => pending.promise);
    render(<EventRemovalDialog event={event} deleting onClose={onClose} onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Да, удалить мероприятие" }));
    expect(screen.getByRole("button", { name: "Удаляем…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Закрыть" })).toBeDisabled();
    const cancel = new Event("cancel", { bubbles: true, cancelable: true });
    fireEvent(screen.getByRole("dialog"), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("button", { name: "Удаляем…" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
  });

  it("ошибка отмены регистрации оставляет диалог и допускает успешную повторную попытку", async () => {
    const user = userEvent.setup(), onClose = vi.fn();
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error("Не удалось отменить")).mockResolvedValue(undefined);
    render(<EventRemovalDialog event={event} deleting={false} onClose={onClose} onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Да, отменить регистрацию" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось отменить");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Да, отменить регистрацию" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  });

  it("клик внутри не закрывает диалог, клик по фону закрывает и возвращает фокус", async () => {
    const user = userEvent.setup(), onClose = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "Открыть"; document.body.append(trigger); trigger.focus();
    const view = render(<EventRemovalDialog event={event} deleting onClose={onClose} onConfirm={vi.fn()} />);
    await user.click(screen.getByText(event.title));
    expect(onClose).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    fireEvent.pointerDown(dialog); fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    trigger.remove();
  });
});
