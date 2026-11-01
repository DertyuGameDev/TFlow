import { useId, useState } from "react";
import { ArrowRight, Users } from "lucide-react";
import type { AttendanceRow } from "../../lib/types";
import { dateLabel } from "../../lib/time";
import { Modal } from "./dialog";
import { ParticipantDetails } from "./profile-data";
import { ParticipantAvatar } from "./participant-avatar";
import "../event-participants.css";

export function EventParticipants({
  rows,
  onShowAll,
}: {
  rows: AttendanceRow[];
  onShowAll: () => void;
}) {
  const headingId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((person) => person.id === selectedId);

  return (
    <section className="event-participants" aria-labelledby={headingId}>
      <header className="event-participants-heading">
        <div>
          <h2 id={headingId}>
            Участники <span>{rows.length}</span>
          </h2>
          {rows.length > 0 && (
            <p>
              {rows.length > 5
                ? "Последние 5 регистраций. Нажмите на участника, чтобы открыть анкету."
                : "Нажмите на участника, чтобы открыть анкету."}
            </p>
          )}
        </div>
        {rows.length > 0 && (
          <button className="text-button" onClick={onShowAll}>
            Все участники
            <ArrowRight size={17} />
          </button>
        )}
      </header>
      {rows.length ? (
        <ul className="event-participants-list">
          {rows.slice(0, 5).map((person) => (
            <li key={person.id}>
              <button
                className="event-participant"
                aria-label={`Открыть профиль: ${person.name}`}
                aria-haspopup="dialog"
                onClick={() => setSelectedId(person.id)}
              >
                <ParticipantAvatar name={person.name} />
                <span className="event-participant-info">
                  <strong>{person.name}</strong>
                  <small>
                    {[person.profile_data.job_title, person.profile_data.organization]
                      .filter(Boolean)
                      .join(" · ") || person.city || "Участник события"}
                  </small>
                </span>
                <span className="event-participant-open">
                  Профиль <ArrowRight size={16} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="event-participants-empty">
          <Users size={20} aria-hidden="true" />
          Пока никто не зарегистрировался. Участники появятся здесь после записи.
        </p>
      )}
      {selected && (
        <Modal
          title={selected.name}
          subtitle="Анкета участника"
          onClose={() => setSelectedId(null)}
        >
          <p className="snapshot-caption">
            Данные при записи · {dateLabel(selected.created_at)}
          </p>
          <ParticipantDetails data={selected.profile_data} />
        </Modal>
      )}
    </section>
  );
}
