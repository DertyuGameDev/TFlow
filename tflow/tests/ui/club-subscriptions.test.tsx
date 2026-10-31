import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Clubs } from "../../app/ui/clubs";
import type { Bootstrap, Community } from "../../lib/types";
import { profile } from "../fixtures";

const club: Community = { id: "club", name: "Клуб разработки", description: "Учимся вместе", topic: "Разработка", color: "yellow", member_count: 5, joined: 1, subscribed: true, owner_id: "host", event_count: 0, avatar_url: null };
function props(community = club) {
  return {
    data: { events: [], tickets: [], schedule: [], waitlist: [], communities: [community], notifications: [], unread_notification_count: 0, profile } satisfies Bootstrap,
    user: { userId: profile.id, displayName: profile.name, fullName: profile.name, email: profile.email, role: profile.role },
    clubId: club.id, send: vi.fn().mockResolvedValue({ ok: true }), onChange: vi.fn().mockResolvedValue(undefined),
    onOpenClub: vi.fn(), onOpenEvent: vi.fn(), onCreateEvent: vi.fn(),
  };
}

describe("подписка на события клуба", () => {
  it("позволяет участнику отключать и включать уведомления", async () => {
    const user = userEvent.setup(), initial = props();
    const view = render(<Clubs {...initial} />);
    const toggle = screen.getByRole("button", { name: "Вы подписаны на события" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await user.click(toggle);
    await waitFor(() => expect(initial.onChange).toHaveBeenCalledOnce());
    expect(initial.send).toHaveBeenCalledExactlyOnceWith("communities/club/subscription", "PATCH", { enabled: false });
    view.rerender(<Clubs {...initial} data={{ ...initial.data, communities: [{ ...club, subscribed: false }] }} />);
    await user.click(screen.getByRole("button", { name: "Подписаться на события" }));
    await waitFor(() => expect(initial.send).toHaveBeenLastCalledWith("communities/club/subscription", "PATCH", { enabled: true }));
  });

  it("не показывает настройку подписки постороннему", () => {
    render(<Clubs {...props({ ...club, joined: 0, subscribed: false })} />);
    expect(screen.queryByRole("button", { name: /подписаны|Подписаться/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Вступить в клуб" })).toBeVisible();
  });

  it("при сбое сохраняет выбор и показывает ошибку", async () => {
    const user = userEvent.setup(), initial = props();
    initial.send.mockRejectedValue(new Error("Сеть недоступна"));
    render(<Clubs {...initial} />);
    await user.click(screen.getByRole("button", { name: "Вы подписаны на события" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сеть недоступна");
    expect(initial.onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Вы подписаны на события" })).toBeEnabled();
  });
});
