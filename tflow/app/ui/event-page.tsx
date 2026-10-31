import { useId, useState, type ReactNode, type KeyboardEvent } from "react";
import { CalendarDays, Check, Clock3 } from "lucide-react";
import type { FlowEvent } from "../../lib/types";
import "../event-page.css";

type Section = "event" | "program" | "personal";
export function EventPage({
  event,
  meta,
  program,
  personal,
  personalCount,
  children,
  organizer,
  signedIn,
  initialSection,
}: {
  event: FlowEvent;
  meta: ReactNode;
  program: ReactNode;
  personal: ReactNode;
  personalCount: number;
  children: ReactNode;
  organizer: boolean;
  signedIn: boolean;
  initialSection?: string;
}) {
  const [section, setSection] = useState<Section>(
    initialSection === "program" ||
      (initialSection === "personal" && !organizer && signedIn)
      ? initialSection
      : "event",
  );
  const id = useId();
  const tabs = [
    { id: "event" as const, label: "Событие", icon: CalendarDays, count: 0 },
    {
      id: "program" as const,
      label: "Программа",
      icon: Clock3,
      count: event.activity_count,
    },
    ...(!organizer && signedIn
      ? [
          {
            id: "personal" as const,
            label: "Моя программа",
            icon: Check,
            count: personalCount,
          },
        ]
      : []),
  ];
  function navigate(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      e.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    setSection(tabs[next].id);
    document.getElementById(`${id}-tab-${tabs[next].id}`)?.focus();
  }
  return (
    <section className="event-page">
      <header className="guest-event-title event-page-heading">
        <span>
          {event.kind} · {event.topic}
        </span>
        <h1>{event.title}</h1>
        {meta}
      </header>
      <div
        className="management-tabs event-page-tabs"
        role="tablist"
        aria-label="Разделы мероприятия"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${id}-tab-${tab.id}`}
            aria-controls={`${id}-panel-${tab.id}`}
            aria-selected={section === tab.id}
            tabIndex={section === tab.id ? 0 : -1}
            onClick={() => setSection(tab.id)}
            onKeyDown={(e) => navigate(e, index)}
          >
            <tab.icon size={18} aria-hidden="true" />
            <span>{tab.label}</span>
            {tab.count > 0 && <small>{tab.count}</small>}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <section
          key={tab.id}
          role="tabpanel"
          id={`${id}-panel-${tab.id}`}
          aria-labelledby={`${id}-tab-${tab.id}`}
          hidden={section !== tab.id}
        >
          {section === tab.id &&
            (tab.id === "event" ? (
              children
            ) : tab.id === "program" ? (
              program
            ) : (
              <>
                <header className="event-personal-heading">
                  <h2>Моя программа</h2>
                  <p>Ваши записи и очередь на активности этого мероприятия.</p>
                </header>
                {personalCount ? (
                  personal
                ) : (
                  <div className="event-personal-empty">
                    <p>Вы ещё не выбрали активности.</p>
                    <button
                      className="button primary"
                      onClick={() => setSection("program")}
                    >
                      Выбрать из программы
                    </button>
                  </div>
                )}
              </>
            ))}
        </section>
      ))}
    </section>
  );
}
