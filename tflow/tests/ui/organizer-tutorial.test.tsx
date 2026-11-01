import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizerTutorial } from "../../app/ui/organizer-tutorial";
import { OrganizerManage } from "../../app/ui/organizer-manage";
import {
  ORGANIZER_LESSONS,
  readTutorialProgress,
  tutorialStorageKey,
} from "../../lib/organizer-tutorial";
import { event } from "../fixtures";

const userId = "tutorial-host";
beforeEach(() => localStorage.clear());

describe("обучение организатора", () => {
  it("можно отложить и открыть снова без навязывания окна", async () => {
    const user = userEvent.setup(),
      onAction = vi.fn();
    const view = render(
      <OrganizerTutorial userId={userId} events={[]} onAction={onAction} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Позже" }));
    expect(
      screen.queryByRole("region", { name: "Обучение организатора" }),
    ).not.toBeInTheDocument();
    view.unmount();
    render(
      <OrganizerTutorial userId={userId} events={[]} onAction={onAction} />,
    );
    await user.click(
      screen.getByRole("button", {
        name: "Инструкция организатора",
      }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: ORGANIZER_LESSONS[0].title }),
    ).toHaveFocus();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("сохраняет шаг и продолжает в кабинете того же пользователя", async () => {
    const user = userEvent.setup();
    const view = render(
      <OrganizerTutorial userId={userId} events={[event]} onAction={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Начать обучение" }));
    await user.click(screen.getByRole("button", { name: "Шаг 3: Программа" }));
    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    view.unmount();
    render(
      <OrganizerTutorial
        userId={userId}
        events={[event]}
        onAction={vi.fn()}
        compact
      />,
    );
    await user.click(screen.getByRole("button", { name: "Инструкция" }));
    expect(
      screen.getByRole("heading", { name: ORGANIZER_LESSONS[2].title }),
    ).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Шаг 3: Программа" }),
    ).toHaveAttribute("aria-current", "step");
    expect(readTutorialProgress("another-host").started).toBe(false);
  });

  it("даёт пройти все шесть шагов без создания, публикации и других действий", async () => {
    const user = userEvent.setup(),
      onAction = vi.fn();
    render(
      <OrganizerTutorial
        userId={userId}
        events={[event]}
        onAction={onAction}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Начать обучение" }));
    expect(screen.getByRole("button", { name: "Назад" })).toBeDisabled();
    for (let step = 1; step < ORGANIZER_LESSONS.length; step++)
      await user.click(screen.getByRole("button", { name: "Пропустить" }));
    await user.click(
      screen.getByRole("button", { name: "Завершить обучение" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Обучение пройдено")).toBeVisible();
    expect(readTutorialProgress(userId).completed).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", {
        name: "Инструкция организатора",
      }),
    );
    expect(
      screen.getByRole("heading", { name: ORGANIZER_LESSONS[0].title }),
    ).toBeVisible();
  });

  it("направляет к выбранному событию, а черновик предлагает сначала подготовить", async () => {
    const user = userEvent.setup(),
      onAction = vi.fn();
    const draft = {
      ...event,
      id: "draft",
      title: "Первый черновик",
      status: "draft" as const,
    };
    const online = {
      ...event,
      id: "online",
      title: "Вебинар",
      format: "Онлайн",
    };
    render(
      <OrganizerTutorial
        userId={userId}
        events={[draft, online]}
        onAction={onAction}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Начать обучение" }));
    await user.click(screen.getByRole("button", { name: "Шаг 6: Проведение" }));
    expect(
      screen.getByRole("button", { name: "Подготовить событие" }),
    ).toBeVisible();
    await user.selectOptions(
      screen.getByRole("combobox", {
        name: "Событие для обучения",
      }),
      "online",
    );
    await user.click(screen.getByRole("button", { name: "Открыть студию" }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith("entry", online);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("работает без сохранения в браузере и восстанавливается после повреждённого прогресса", async () => {
    const user = userEvent.setup();
    localStorage.setItem(tutorialStorageKey(userId), '{"step":99}');
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage disabled");
    });
    render(
      <OrganizerTutorial userId={userId} events={[]} onAction={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Начать обучение" }));
    await user.click(screen.getByRole("button", { name: "Пропустить" }));
    expect(
      screen.getByRole("heading", { name: ORGANIZER_LESSONS[1].title }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Создать черновик" }),
    ).toBeVisible();
  });

  it("из инструкции открывает программу прямо внутри управления событием", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <OrganizerManage
        detail={{ event, rooms: [], activities: [] }}
        rows={[]}
        busy={false}
        onCreate={onCreate}
        onScan={vi.fn()}
        onMove={vi.fn()}
        onSchedule={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onPublish={vi.fn()}
        onRoom={vi.fn()}
        onActivity={vi.fn()}
        onOpenPublic={vi.fn()}
        onOpenWebinar={vi.fn()}
        send={vi.fn()}
        refresh={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Инструкция" }));
    const guide = screen.getByRole("dialog");
    await user.click(
      within(guide).getByRole("button", {
        name: "Шаг 3: Программа",
      }),
    );
    await user.click(
      within(guide).getByRole("button", {
        name: "Открыть программу",
      }),
    );
    expect(screen.getByRole("tab", { name: /^Программа/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(onCreate).not.toHaveBeenCalled();
  });
});
