import { useId, type ComponentProps } from "react";
import { ArrowRight, ListOrdered } from "lucide-react";
import { ActivityProgram } from "./activity-program";
import { FlowSchedule, useFlowClock } from "./flow-schedule";
import type { FlowRange } from "../../lib/flow-layout";
import "../event-flows.css";

type Props = Omit<ComponentProps<typeof ActivityProgram>, "personal"> & {
  onManage?: () => void;
};

function EmptyEventTimeline({ event }: { event: FlowRange }) {
  const now = useFlowClock([]);
  return (
    <FlowSchedule event={event} activities={[]} now={now} renderActivity={() => null} />
  );
}

export function EventFlows({ onManage, ...program }: Props) {
  const headingId = useId();
  return (
    <section className="event-flows" aria-labelledby={headingId}>
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
          <ActivityProgram {...program} vertical />
        </>
      ) : (
        <>
          <div className="event-flows-empty">
            <ListOrdered size={24} aria-hidden="true" />
            <p>
              Активности пока не добавлены. Здесь появятся флоу с временем,
              аудиторией и спикером.
            </p>
          </div>
          {program.event && <EmptyEventTimeline event={program.event} />}
        </>
      )}
    </section>
  );
}
