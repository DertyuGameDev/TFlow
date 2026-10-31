import { useEffect, useId, useRef, type ComponentProps } from "react";
import { ArrowRight, ListOrdered } from "lucide-react";
import { ActivityProgram } from "./activity-program";
import "../event-flows.css";

type Props = Omit<ComponentProps<typeof ActivityProgram>, "personal"> & {
  onManage?: () => void;
  focusActivityId?: string;
};

export function EventFlows({ onManage, focusActivityId, ...program }: Props) {
  const headingId = useId();
  const focused = useRef("");
  useEffect(() => {
    if (!focusActivityId) { focused.current = ""; return; }
    if (focused.current === focusActivityId) return;
    const item = document.getElementById(`flow-${focusActivityId}`);
    if (item) { item.scrollIntoView({block:"center"}); item.focus({preventScroll:true}); focused.current = focusActivityId; }
  }, [focusActivityId,program.activities]);
  return (
    <section id="event-flows" className="event-flows" aria-labelledby={headingId}>
      <header className="event-flows-heading">
        <div>
          <h2 id={headingId}>
            Флоу <span>{program.activities.length}</span>
          </h2>
          <p>Выбирайте активности и собирайте свою программу.</p>
        </div>
        {onManage && (
          <button className="text-button" onClick={onManage}>
            Управлять флоу <ArrowRight size={17} />
          </button>
        )}
      </header>
      {program.activities.length ? (
        <>
          {!program.organizer && <p className="event-flows-hint">
            {program.activities.some(item => item.registration_required === false)
              ? "Активности без отдельной записи доступны участникам мероприятия. Добавляйте их в расписание; на остальные бронируйте место."
              : "Запишитесь на понравившиеся активности. Проверим пересечения в расписании; если места закончились, можно встать в лист ожидания."}
          </p>}
          <ActivityProgram {...program} focusActivityId={focusActivityId} vertical />
        </>
      ) : (
        <div className="event-flows-empty">
          <ListOrdered size={24} aria-hidden="true" />
          <p>
            Активности пока не добавлены. Здесь появятся флоу с временем,
            аудиторией и спикером.
          </p>
        </div>
      )}
    </section>
  );
}
