import { useId, type ComponentProps } from "react";
import { ArrowRight, ListOrdered } from "lucide-react";
import { ActivityProgram } from "./activity-program";
import "../event-flows.css";

type Props = Omit<ComponentProps<typeof ActivityProgram>, "personal"> & {
  onManage?: () => void;
};

export function EventFlows({ onManage, ...program }: Props) {
  const headingId = useId();
  return (
    <section className="event-flows" aria-labelledby={headingId}>
      <header className="event-flows-heading">
        <div>
          <h2 id={headingId}>Флоу <span>{program.activities.length}</span></h2>
          <p>Активности мероприятия: выбирайте, что вам интересно.</p>
        </div>
        {onManage && <button className="text-button" onClick={onManage}>
          Управлять флоу <ArrowRight size={17} />
        </button>}
      </header>
      {program.activities.length ? (
        <>
          {!program.organizer && <p className="event-flows-hint">
            Запишитесь на понравившиеся активности. Проверим пересечения в расписании;
            если места закончились, можно встать в лист ожидания.
          </p>}
          <ActivityProgram {...program} />
        </>
      ) : (
        <div className="event-flows-empty">
          <ListOrdered size={24} aria-hidden="true" />
          <p>Активности пока не добавлены. Здесь появятся флоу с временем, аудиторией и спикером.</p>
        </div>
      )}
    </section>
  );
}
