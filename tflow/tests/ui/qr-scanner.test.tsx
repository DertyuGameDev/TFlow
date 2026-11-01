import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QRScanner } from "../../app/ui/qr-scanner";
import { ApiError } from "../../lib/api-error";
import type { ScanResult } from "../../lib/types";
import { event, profile } from "../fixtures";

const usedMessage = "QR-код уже использован для входа на это мероприятие. Повторный вход запрещён";
const admitted: ScanResult = {
  admitted: true,
  already_checked_in: false,
  checked_in_at: event.starts_at,
  attendee: { ...profile, profile_data: profile, activities: [] },
};

function mount(send = vi.fn().mockResolvedValue(admitted)) {
  const onScan = vi.fn();
  render(<QRScanner event={event} events={[event]} activities={[]} send={send} onScan={onScan} />);
  return { send, onScan };
}

async function scanManually(qr = "https://example.test/#pass/test-pass") {
  const user = userEvent.setup();
  await user.click(screen.getByText("Проверить по ссылке"));
  await user.type(screen.getByRole("textbox", { name: "Ссылка или код из QR" }), qr);
  await user.click(screen.getByRole("button", { name: "Проверить и отметить" }));
}

describe("выбор события для сканирования", () => {
  const secondEvent = { ...event, id: "event-two", title: "Вторая встреча" };

  it("сразу готов к проверке, если у организатора одно событие", async () => {
    const send = vi.fn().mockResolvedValue(admitted);
    render(<QRScanner events={[event]} send={send} onScan={vi.fn()} />);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(event.title)).toBeVisible();
    expect(screen.getByText("Проверяем вход на событие")).toBeVisible();
    expect(screen.getByRole("button", { name: "Включить камеру" })).toBeEnabled();
    expect(screen.getByLabelText("Загрузить фотографию QR")).toBeEnabled();

    await scanManually();
    await waitFor(() => expect(send).toHaveBeenCalledWith(`events/${event.id}/check-in`, "POST", {
      qr: "https://example.test/#pass/test-pass",
    }));
  });

  it("предлагает только реальные события и ждёт явного выбора, если их несколько", async () => {
    const send = vi.fn().mockResolvedValue(admitted);
    render(<QRScanner events={[event, secondEvent]} send={send} onScan={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "На какое событие проверяем вход?" })).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Включить камеру" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Загрузить фотографию QR")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(event.title) })).toBeVisible();
    expect(screen.getByRole("button", { name: new RegExp(secondEvent.title) })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(secondEvent.title) }));
    expect(screen.getByRole("button", { name: "Включить камеру" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Включить камеру" })).toHaveFocus();
    expect(screen.getByLabelText("Загрузить фотографию QR")).toBeEnabled();
    expect(screen.getByText("Проверяем вход на событие")).toBeVisible();
    expect(screen.getByText(secondEvent.title)).toBeVisible();
    await scanManually();
    await waitFor(() => expect(send).toHaveBeenCalledWith(`events/${secondEvent.id}/check-in`, "POST", {
      qr: "https://example.test/#pass/test-pass",
    }));
  });

  it("выбирает единственное событие и после загрузки списка", () => {
    const props = { send: vi.fn(), onScan: vi.fn() };
    const { rerender } = render(<QRScanner events={[]} {...props} />);
    expect(screen.getByRole("heading", { name: "Сначала создайте событие" })).toBeVisible();

    rerender(<QRScanner events={[event]} {...props} />);
    expect(screen.getByText(event.title)).toBeVisible();
    expect(screen.getByRole("button", { name: "Включить камеру" })).toBeEnabled();
  });

  it("не продолжает проверку для события, которого больше нет в списке", async () => {
    const props = { send: vi.fn(), onScan: vi.fn() };
    const { rerender } = render(<QRScanner events={[event, secondEvent]} {...props} />);
    await userEvent.click(screen.getByRole("button", { name: new RegExp(event.title) }));

    rerender(<QRScanner events={[secondEvent, { ...event, id: "event-three" }]} {...props} />);
    expect(screen.getByRole("heading", { name: "На какое событие проверяем вход?" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Включить камеру" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Загрузить фотографию QR")).not.toBeInTheDocument();
  });

  it("позволяет явно сменить событие и проверяет QR для нового выбора", async () => {
    const send = vi.fn().mockResolvedValue(admitted);
    render(<QRScanner events={[event, secondEvent]} send={send} onScan={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: new RegExp(event.title) }));
    await userEvent.click(screen.getByRole("button", { name: "Сменить событие" }));
    expect(screen.getByRole("heading", { name: "На какое событие проверяем вход?" })).toHaveFocus();
    expect(screen.getByRole("button", { name: new RegExp(event.title) })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: new RegExp(secondEvent.title) }));
    await scanManually();
    await waitFor(() => expect(send).toHaveBeenCalledWith(`events/${secondEvent.id}/check-in`, "POST", {
      qr: "https://example.test/#pass/test-pass",
    }));
  });

  it("находит нужное событие в большом списке по названию или месту", async () => {
    const events = Array.from({ length: 8 }, (_, index) => ({ ...event, id: `event-${index}`, title: `Встреча ${index}`, venue: `Зал ${index}` }));
    render(<QRScanner events={events} send={vi.fn()} onScan={vi.fn()} />);
    const search = screen.getByRole("searchbox", { name: "Найти событие для проверки входа" });
    await userEvent.type(search, "Зал 7");
    expect(screen.getByRole("button", { name: /Встреча 7/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Встреча 0/ })).not.toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, "нет такого события");
    expect(screen.getByRole("status")).toHaveTextContent("События не найдены");
    await userEvent.clear(search);
    await userEvent.type(search, "Встреча 2");
    await userEvent.click(screen.getByRole("button", { name: /Встреча 2/ }));
    expect(screen.getByText("Встреча 2")).toBeVisible();
    expect(screen.getByRole("button", { name: "Включить камеру" })).toBeEnabled();
  });
});

describe("одноразовый вход по QR", () => {
  it("подтверждает первый вход и показывает отказ при повторном сканировании", async () => {
    const send = vi.fn().mockResolvedValueOnce(admitted).mockRejectedValueOnce(
      new ApiError({ code: "ALREADY_CHECKED_IN", error: usedMessage }),
    );
    const { onScan } = mount(send);
    await scanManually();
    expect(await screen.findByRole("heading", { name: "Вход подтверждён" })).toBeVisible();
    expect(onScan).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "Проверить и отметить" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("scan-rejected");
    expect(alert).toHaveTextContent(usedMessage);
    expect(screen.queryByRole("heading", { name: "Вход подтверждён" })).not.toBeInTheDocument();
    expect(screen.queryByText(profile.email)).not.toBeInTheDocument();
    expect(onScan).toHaveBeenCalledOnce();
    expect(send).toHaveBeenNthCalledWith(2, `events/${event.id}/check-in`, "POST", {
      qr: "https://example.test/#pass/test-pass",
    });
  });

  it("не показывает разрешение входа при повторной отметке в старом формате ответа", async () => {
    const { onScan } = mount(vi.fn().mockResolvedValue({ ...admitted, already_checked_in: true }));
    await scanManually();
    expect(await screen.findByRole("alert")).toHaveTextContent(usedMessage);
    expect(screen.queryByRole("heading", { name: "Вход подтверждён" })).not.toBeInTheDocument();
    expect(onScan).not.toHaveBeenCalled();
  });

  it("не подтверждает вход при отрицательном admitted", async () => {
    const { onScan } = mount(vi.fn().mockResolvedValue({ ...admitted, admitted: false }));
    await scanManually();
    expect(await screen.findByRole("alert")).toHaveClass("scan-rejected");
    expect(screen.queryByRole("heading", { name: "Вход подтверждён" })).not.toBeInTheDocument();
    await waitFor(() => expect(onScan).not.toHaveBeenCalled());
  });
});
