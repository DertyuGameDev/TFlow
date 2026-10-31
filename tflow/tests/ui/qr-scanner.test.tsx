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
  render(<QRScanner event={event} events={[event]} send={send} onScan={onScan} />);
  return { send, onScan };
}

async function scanManually(qr = "https://example.test/#pass/test-pass") {
  const user = userEvent.setup();
  await user.click(screen.getByText("Проверить по ссылке"));
  await user.type(screen.getByRole("textbox", { name: "Ссылка или код из QR" }), qr);
  await user.click(screen.getByRole("button", { name: "Проверить и отметить" }));
}

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
