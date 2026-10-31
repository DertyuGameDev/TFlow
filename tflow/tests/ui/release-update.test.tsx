import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReleaseUpdate } from "../../app/ui/release-update";

describe("обновление открытой вкладки", () => {
  it("обнаруживает новую версию, сохраняя введённое до явного обновления", async () => {
    const reload = vi.fn(), user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"b".repeat(40)}))));
    render(<><input aria-label="Черновик"/><ReleaseUpdate version={"a".repeat(40)} enabled reload={reload}/></>);
    await user.type(screen.getByLabelText("Черновик"), "Несохранённое название");
    await screen.findByRole("status", {name:"Обновление приложения"});
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Черновик")).toHaveValue("Несохранённое название");
    await user.click(screen.getByRole("button", {name:"Обновить"}));
    expect(reload).toHaveBeenCalledOnce();
  });
  it("повторно проверяет версию при возврате во вкладку", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({id:"a".repeat(40)})))
      .mockResolvedValueOnce(new Response(JSON.stringify({id:"b".repeat(40)})));
    vi.stubGlobal("fetch", fetcher);
    render(<ReleaseUpdate version={"a".repeat(40)} enabled/>);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await waitFor(() => { fireEvent.focus(window); expect(fetcher).toHaveBeenCalledTimes(2); });
    expect(await screen.findByRole("status")).toBeVisible();
  });
  it("сбой сети не мешает работе и не предлагает ложное обновление", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<ReleaseUpdate version={"a".repeat(40)} enabled/>);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
